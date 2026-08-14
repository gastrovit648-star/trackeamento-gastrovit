import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { normalizePhoneBR } from "@/lib/phone";
import { sendOrderPurchaseCAPI } from "@/lib/purchase-capi";
import { getWebhookSecrets } from "@/lib/webhook-secrets";

/**
 * Webhook de postback da Payt (e da Luminar-pay) — confirma compras e dispara
 * Purchase no Meta CAPI.
 *
 * Autenticação: header `x-payt-secret` OU query string `?token=<secret>`
 * deve bater com o secret configurado no painel (app_settings) ou, na
 * ausência, com a env PAYT_WEBHOOK_SECRET. A Payt não permite custom headers
 * no postback, então o caminho oficial é via query string. O header continua
 * suportado pra testes locais via curl.
 *
 * Duas plataformas postam neste MESMO endpoint (mesma URL):
 *   - Payt: valor da venda = item `type:"producer"` do array `commission`
 *     (líquido, após taxas).
 *   - Luminar-pay (identificada por integration_key/seller_id == "luminar-pay"):
 *     payload quase idêntico ao da Payt, mas o valor vem em
 *     `transaction.net_profit` (lucro líquido, em CENTAVOS). Demais campos
 *     (status "paid", customer.phone/email/name, billing_address.estate/zipcode)
 *     caem nos mesmos caminhos já tratados pela Payt.
 *
 * Filtros e regras importantes:
 *   - Compras de afiliados que NÃO estão em `attendants` são ignoradas.
 *   - Status `refunded/cancelled/chargeback/protest` só atualizam status, não
 *     redisparam o evento.
 *   - Idempotência por meta_event_id determinístico → Meta deduplica mesmo
 *     se a Payt reenviar.
 *   - Pixel usado: lead.pixel_id (se match por phone) ou pixel default.
 *   - action_source: "website" mesmo sendo evento de WhatsApp (decisão de
 *     atribuição: trata como evento web pra usar ctwa_clid no custom_data).
 */

interface PaytParsed {
  transaction_id: string | null;
  status: "approved" | "refunded" | "pending" | "refused" | "scheduled" | null;
  paymentMethod: "credit_card" | "boleto" | "pix" | null;
  phoneRaw: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  value: number;
  currency: string;
  productName: string | null;
  productId: string | null;
  affiliateEmail: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePayt(body: any): PaytParsed {
  const transaction_id =
    body?.transaction_id ?? body?.transaction?.id ?? body?.id ?? null;

  // Status: Payt usa nomes como "paid", "approved", "complete", "refunded",
  // "chargeback", "cancelled". Luminar-pay manda "waiting_payment" quando o
  // boleto/PIX é gerado e "refused" quando o cartão é recusado. Mapear pra
  // nosso enum (approved/refunded/pending/refused).
  const rawStatus = String(
    body?.status ?? body?.transaction?.status ?? body?.payment_status ?? ""
  ).toLowerCase();
  let status: PaytParsed["status"] = null;
  if (["approved", "paid", "complete", "completed", "success"].includes(rawStatus)) {
    status = "approved";
  } else if (["refunded", "cancelled", "canceled", "chargeback", "protest"].includes(rawStatus)) {
    status = "refunded";
  } else if (["pending", "waiting", "waiting_payment", "processing"].includes(rawStatus)) {
    status = "pending";
  } else if (["refused", "declined", "denied"].includes(rawStatus)) {
    status = "refused";
  } else if (["scheduled", "schedule", "agendado"].includes(rawStatus)) {
    // Agendamento (Pay After Delivery) — Luminar manda status "scheduled". O
    // pedido conta como agendamento (atribuído por telefone) mas NÃO dispara
    // Purchase. Quando o pagamento confirmar depois, cai no fluxo "approved".
    status = "scheduled";
  }

  // Método de pagamento — Luminar/Payt mandam em transaction.payment_method
  // ("pix" | "boleto" | "credit_card"). Normalização defensiva por substring
  // pra aguentar variações ("bank_slip", "creditcard"). Desconhecido → null.
  const rawMethod = String(
    body?.transaction?.payment_method ?? body?.payment_method ??
    body?.payment?.method ?? ""
  ).toLowerCase();
  let paymentMethod: PaytParsed["paymentMethod"] = null;
  if (rawMethod.includes("pix")) {
    paymentMethod = "pix";
  } else if (rawMethod.includes("boleto") || rawMethod.includes("billet") || rawMethod.includes("bank_slip")) {
    paymentMethod = "boleto";
  } else if (rawMethod.includes("card") || rawMethod.includes("credit") || rawMethod.includes("cartao")) {
    paymentMethod = "credit_card";
  }

  const customer = body?.customer ?? body?.buyer ?? body?.client ?? {};
  const phoneRaw = customer?.phone ?? customer?.phone_number ?? body?.phone ?? null;
  const email = (customer?.email ?? body?.email ?? null) || null;
  const fullName: string | null = customer?.name ?? body?.name ?? null;
  const [firstName, ...rest] = (fullName ?? "").trim().split(/\s+/);
  const lastName = rest.length ? rest.join(" ") : null;

  // Valor da venda — prioridade em ordem decrescente:
  //
  //   1. Valor do PRODUCER no array de participantes (rateio da Payt).
  //      Esse é o valor real que cai pro cliente, descontando taxas,
  //      afiliados e supplier. É o que faz sentido como "conversão"
  //      no Meta CAPI e em todas as métricas do dashboard (ROAS, lucro,
  //      faturamento aprovado).
  //
  //   2. transaction.price_without_installments (valor total sem juros).
  //      Fallback se o array de participants não existir.
  //
  //   3. transaction.total_price (valor total com juros do parcelamento).
  //
  //   4. Fallbacks legados (amount/value em reais) — pra payloads de teste.
  //
  // Todos os caminhos da Payt vêm em CENTAVOS — dividimos por 100.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Payload real da Payt usa `commission` (singular). Mantemos variações
  // pra resiliência caso eles padronizem no futuro.
  const participants: Array<{ type?: string; amount?: number; email?: string; name?: string }> =
    body?.commission ?? body?.participants ?? body?.commissions ?? body?.recipients ??
    body?.transaction?.commission ?? body?.transaction?.participants ?? body?.transaction?.commissions ?? [];
  const producer = Array.isArray(participants)
    ? participants.find(p => p?.type === "producer")
    : null;
  const producerCents = producer?.amount ? Number(producer.amount) : 0;

  // Luminar-pay posta neste mesmo endpoint e NÃO usa o array `commission`.
  // O valor da venda vem em transaction.net_profit (lucro líquido, em centavos).
  // Identificação: integration_key/seller_id == "luminar-pay".
  const isLuminar =
    body?.integration_key === "luminar-pay" || body?.seller_id === "luminar-pay";
  const netProfitCents = Number(body?.transaction?.net_profit) || 0;

  let value: number;
  if (isLuminar && netProfitCents > 0) {
    value = netProfitCents / 100;
  } else if (producerCents > 0) {
    value = producerCents / 100;
  } else {
    const fallbackCents =
      Number(body?.transaction?.price_without_installments) ||
      Number(body?.transaction?.total_price) ||
      0;
    value = fallbackCents > 0
      ? fallbackCents / 100
      : Number(
          body?.amount ?? body?.value ?? body?.transaction?.amount ?? body?.price?.value ?? 0,
        );
  }
  const currency = String(
    body?.currency ?? body?.transaction?.currency ?? body?.price?.currency ?? "BRL"
  ).toUpperCase();

  const product = body?.product ?? body?.item ?? {};
  const productName = product?.name ?? null;
  const productId = product?.id ? String(product.id) : null;

  // Afiliado da venda — Payt entrega no mesmo array `commission` com
  // type: "affiliation" (não em campo `affiliate` separado). Quando a venda
  // for direta (sem afiliação), o item não aparece no array.
  const affiliation = Array.isArray(participants)
    ? participants.find(p => p?.type === "affiliation")
    : null;
  const affiliateEmail =
    affiliation?.email ??
    // Fallbacks defensivos pra outras integrações que possam reusar este parser
    body?.affiliate?.email ?? body?.affiliates?.[0]?.email ?? null;

  // Geo — Payt manda em customer.billing_address.{city,country,estate} (sic:
  // a Payt grafa "estate" em vez de "state", confirmado via GTM em produção).
  // Mantemos fallbacks pra "state" e outras shapes pra resiliência.
  // Normalização (lowercase / sem acentos / só dígitos pro ZIP) acontece no
  // sendMetaCAPI antes do hash.
  const billing = customer?.billing_address ?? customer?.address ?? body?.address ?? {};
  const city =
    billing?.city ?? customer?.city ?? body?.city ?? null;
  const state =
    billing?.estate ?? billing?.state ?? billing?.uf ??
    customer?.state ?? body?.state ?? null;
  const country =
    billing?.country ?? customer?.country ?? body?.country ?? "BR";
  const zip =
    billing?.zip_code ?? billing?.zipcode ?? billing?.zip ??
    billing?.postal_code ?? billing?.cep ??
    customer?.zip_code ?? customer?.zipcode ?? customer?.cep ?? null;

  return {
    transaction_id: transaction_id ? String(transaction_id) : null,
    status,
    paymentMethod,
    phoneRaw: phoneRaw ? String(phoneRaw) : null,
    email,
    firstName: firstName || null,
    lastName,
    value,
    currency,
    productName,
    productId,
    affiliateEmail: affiliateEmail ? String(affiliateEmail).toLowerCase() : null,
    city: city ? String(city) : null,
    state: state ? String(state) : null,
    country: country ? String(country) : null,
    zip: zip ? String(zip) : null,
  };
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  // Lê o corpo cru ANTES de qualquer filtro, pra conseguir logar mesmo
  // payloads inválidos ou com token errado.
  const rawText = await request.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  let parseError = false;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    parseError = true;
  }

  // Origem (só pra rotular o log): Luminar-pay é identificada por
  // integration_key/seller_id; o resto assume-se Payt.
  const source =
    body && (body.integration_key === "luminar-pay" || body.seller_id === "luminar-pay")
      ? "luminar-pay"
      : body
        ? "payt"
        : "unknown";

  // Grava 1 linha em webhook_log por POST recebido, em CADA ponto de saída.
  // Best-effort: falha de log nunca derruba o processamento do webhook.
  const recordWebhook = async (
    outcome: "accepted" | "rejected",
    reason: string,
    httpStatus: number,
    transactionId: string | null = null,
  ) => {
    try {
      await supabase.from("webhook_log").insert({
        source,
        endpoint: "/api/webhook/payt",
        outcome,
        reason,
        http_status: httpStatus,
        transaction_id: transactionId,
        payload: parseError ? { raw: rawText } : body,
      });
    } catch (e) {
      console.error("[webhook/payt] webhook_log insert falhou:", e);
    }
  };

  try {
    const secret =
      request.headers.get("x-payt-secret") ??
      request.nextUrl.searchParams.get("token");
    const { payt: expected } = await getWebhookSecrets();
    if (!secret || !expected.value || secret !== expected.value) {
      await recordWebhook("rejected", "unauthorized", 401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (parseError || body === null) {
      await recordWebhook("rejected", "parse_error", 400);
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parsePayt(body);

    if (!parsed.transaction_id) {
      console.warn("[webhook/payt] sem transaction_id — payload ignorado");
      await recordWebhook("rejected", "no_transaction_id", 200);
      return NextResponse.json({ ignored: "no_transaction_id" });
    }

    // ── Refund / chargeback / cancelamento ──────────────────────────────────
    // Roda ANTES do filtro de afiliado, de propósito: um estorno é sobre uma
    // venda que já foi (ou não) rastreada. Se a venda existe, ela precisa cair
    // pra refunded independentemente de o afiliado estar em `attendants` hoje —
    // senão um afiliado desativado depois da venda deixaria o estorno preso em
    // approved.
    //
    // UPDATE, não upsert: o upsert anterior montava um INSERT com value=NULL e
    // esbarrava no NOT NULL de purchases.value; o comando falhava e o erro era
    // engolido (o webhook_log gravava status_only:refunded + 200 enquanto o
    // status no banco continuava approved). Um UPDATE só toca a coluna
    // informada e só em linha existente — estorno de venda nunca rastreada
    // (ex: afiliado externo) vira no-op sem linha órfã. approved_at NÃO muda:
    // a venda continua contando no dia da aprovação (migration 016).
    if (parsed.status === "refunded") {
      const { data: updated, error: refundError } = await supabase
        .from("purchases")
        .update({ status: parsed.status })
        .eq("transaction_id", parsed.transaction_id)
        .select("id");
      if (refundError) {
        console.error("[webhook/payt] refund update falhou:", refundError);
        await recordWebhook("rejected", "refund_update_error", 500, parsed.transaction_id);
        return NextResponse.json({ error: refundError.message }, { status: 500 });
      }
      const matched = (updated?.length ?? 0) > 0;
      await recordWebhook(
        "accepted",
        matched ? `status_only:${parsed.status}` : "refund_no_match",
        200,
        parsed.transaction_id,
      );
      return NextResponse.json({ success: true, status_only: parsed.status, matched });
    }

    // ── FILTRO DE AFILIADO ──────────────────────────────────────────────────
    if (parsed.affiliateEmail) {
      const { data: attendant } = await supabase
        .from("attendants")
        .select("email")
        .eq("email", parsed.affiliateEmail)
        .eq("is_active", true)
        .maybeSingle();
      if (!attendant) {
        console.log(`[webhook/payt] afiliado externo ${parsed.affiliateEmail} — ignorado`);
        await recordWebhook("rejected", "foreign_affiliate", 200, parsed.transaction_id);
        return NextResponse.json({ ignored: "foreign_affiliate" });
      }
    }

    // ── Pending (boleto/PIX gerado) e refused (cartão recusado) ─────────────
    // Grava a transação COMPLETA (valor, cliente, método, atribuição via lead
    // match) pra alimentar as métricas "Boleto gerado" / "PIX gerado" /
    // "Cartão recusado" no Overview e na árvore de Campanhas. NÃO dispara CAPI.
    if (parsed.status === "pending" || parsed.status === "refused" || parsed.status === "scheduled") {
      // Nunca rebaixa uma venda já finalizada — retry atrasado de
      // waiting_payment (ou um agendamento que chega depois do pagamento) não
      // pode sobrescrever um approved/refunded.
      const { data: existingRow } = await supabase
        .from("purchases")
        .select("status, scheduled_at, meta_event_id, capi_scheduled_at")
        .eq("transaction_id", parsed.transaction_id)
        .maybeSingle();
      const existing = existingRow as {
        status: string; scheduled_at: string | null;
        meta_event_id: string | null; capi_scheduled_at: string | null;
      } | null;
      const existingStatus = existing?.status;
      if (existingStatus === "approved" || existingStatus === "refunded") {
        await recordWebhook("accepted", `stale_status:${parsed.status}`, 200, parsed.transaction_id);
        return NextResponse.json({ success: true, stale_status: parsed.status });
      }
      // scheduled_at é PERSISTENTE: setado na 1ª vez que o pedido é agendado e
      // preservado depois (mesmo quando vira pending/approved). A coluna
      // AGENDAMENTO da árvore conta por ele. Só pedidos 'scheduled' carimbam.
      const scheduledAt =
        parsed.status === "scheduled"
          ? existing?.scheduled_at ?? new Date().toISOString()
          : existing?.scheduled_at ?? null;

      type PendingLead = {
        ctwa_clid: string | null;
        campaign_id: string | null; campaign_name: string | null;
        adset_id: string | null;    adset_name: string | null;
        ad_id: string | null;       ad_name: string | null;
        ad_account_id: string | null;
      };
      const pendingPhone = normalizePhoneBR(parsed.phoneRaw);
      let pendingLead: PendingLead | null = null;
      if (pendingPhone) {
        const { data } = await supabase
          .from("leads")
          .select("ctwa_clid, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, ad_account_id")
          .eq("phone", pendingPhone)
          .maybeSingle();
        pendingLead = (data as PendingLead | null) ?? null;
      }

      const { error: pendingError } = await supabase
        .from("purchases")
        .upsert(
          {
            transaction_id: parsed.transaction_id,
            phone: pendingPhone,
            phone_hash: pendingPhone ? await sha256(pendingPhone) : null,
            email: parsed.email,
            product_name: parsed.productName,
            product_id: parsed.productId,
            value: parsed.value,
            currency: parsed.currency,
            status: parsed.status,
            source,
            // Agendamento ainda não tem método de pagamento (paga na entrega) —
            // força null pra não contar nas colunas Boleto/PIX.
            payment_method: parsed.status === "scheduled" ? null : parsed.paymentMethod,
            scheduled_at: scheduledAt,
            affiliate_email: parsed.affiliateEmail,
            matched_lead: !!pendingLead,
            campaign_id:   pendingLead?.campaign_id   ?? null,
            campaign_name: pendingLead?.campaign_name ?? null,
            adset_id:      pendingLead?.adset_id      ?? null,
            adset_name:    pendingLead?.adset_name    ?? null,
            ad_id:         pendingLead?.ad_id         ?? null,
            ad_name:       pendingLead?.ad_name       ?? null,
            ad_account_id: pendingLead?.ad_account_id ?? null,
            raw_webhook: body,
          },
          { onConflict: "transaction_id" },
        );
      if (pendingError) {
        console.error("[webhook/payt] pending upsert falhou:", pendingError);
        await recordWebhook("rejected", "pending_upsert_error", 500, parsed.transaction_id);
        return NextResponse.json({ error: pendingError.message }, { status: 500 });
      }

      // ── Purchase no AGENDAMENTO (por pixel) ─────────────────────────────
      // Dispara pros pixels com capi_mode 'schedule'/'both'. capi_scheduled_at
      // é o guard de idempotência (não reenvia em retry do webhook). NÃO seta
      // meta_event_id — esse é da VENDA (o pagamento depois envia pros pixels de
      // venda). O event_id é o mesmo, então pixel 'both' o Meta dedupa.
      let capiSent = 0;
      if (parsed.status === "scheduled" && !existing?.capi_scheduled_at) {
        const capi = await sendOrderPurchaseCAPI({
          transactionId: parsed.transaction_id,
          phone: pendingPhone,
          email: parsed.email,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          city: parsed.city,
          state: parsed.state,
          country: parsed.country,
          zip: parsed.zip,
          value: parsed.value,
          currency: parsed.currency,
          productName: parsed.productName,
          productId: parsed.productId,
          ctwaClid: pendingLead?.ctwa_clid ?? null,
          eventSourceUrl: "https://payt.com.br/checkout",
        }, "schedule");
        await supabase
          .from("purchases")
          .update({
            capi_scheduled_at: new Date().toISOString(),
            response_meta: capi.aggregatedResponse,
            email_hash: capi.emailHash,
            first_name_hash: capi.firstNameHash,
            last_name_hash: capi.lastNameHash,
          })
          .eq("transaction_id", parsed.transaction_id);
        capiSent = capi.fanOutCount;
      }

      await recordWebhook("accepted", `status_only:${parsed.status}`, 200, parsed.transaction_id);
      return NextResponse.json({ success: true, status_only: parsed.status, capi_sent: capiSent });
    }

    if (parsed.status !== "approved") {
      await recordWebhook("rejected", "unknown_status", 200, parsed.transaction_id);
      return NextResponse.json({ ignored: "unknown_status" });
    }

    // ── IDEMPOTÊNCIA ────────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("purchases")
      .select("meta_event_id")
      .eq("transaction_id", parsed.transaction_id)
      .maybeSingle();
    if ((existing as { meta_event_id: string | null } | null)?.meta_event_id) {
      console.log(`[webhook/payt] dedup tx=${parsed.transaction_id}`);
      // Purchase já foi enviado (ex.: no agendamento com purchase_on_schedule).
      // Se o pedido ainda está 'scheduled', promove pra approved pra a receita
      // entrar no dashboard — sem reenviar CAPI. O .eq("status","scheduled")
      // garante que um retry de venda já aprovada vira no-op.
      await supabase
        .from("purchases")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("transaction_id", parsed.transaction_id)
        .eq("status", "scheduled");
      await recordWebhook("accepted", "deduped", 200, parsed.transaction_id);
      return NextResponse.json({ success: true, deduped: true });
    }

    // ── Phone normalizado + lead match ──────────────────────────────────────
    const phone = normalizePhoneBR(parsed.phoneRaw);

    type LeadRow = {
      phone: string;
      ctwa_clid: string | null;
      ad_account_id: string | null;
      campaign_id: string | null;
      campaign_name: string | null;
      adset_id: string | null;
      adset_name: string | null;
      ad_id: string | null;
      ad_name: string | null;
    };
    let lead: LeadRow | null = null;
    if (phone) {
      const { data } = await supabase
        .from("leads")
        .select("phone, ctwa_clid, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name")
        .eq("phone", phone)
        .maybeSingle();
      lead = (data as LeadRow | null) ?? null;
    }

    // ── Envia Purchase ao Meta CAPI (fan-out) via helper compartilhado ──────
    // Mesmo helper usado pelo agendamento com purchase_on_schedule. Se um
    // agendamento já disparou (meta_event_id setado), o guard de idempotência
    // acima já teria retornado — então aqui é sempre o 1º envio.
    const capi = await sendOrderPurchaseCAPI({
      transactionId: parsed.transaction_id,
      phone,
      email: parsed.email,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      city: parsed.city,
      state: parsed.state,
      country: parsed.country,
      zip: parsed.zip,
      value: parsed.value,
      currency: parsed.currency,
      productName: parsed.productName,
      productId: parsed.productId,
      ctwaClid: lead?.ctwa_clid ?? null,
      eventSourceUrl: "https://payt.com.br/checkout",
    }, "sale");

    // ── Upsert purchases ────────────────────────────────────────────────────
    const { error: purchaseError } = await supabase
      .from("purchases")
      .upsert(
        {
          transaction_id: parsed.transaction_id,
          phone,
          phone_hash: capi.phoneHash,
          email: parsed.email,
          email_hash: capi.emailHash,
          first_name_hash: capi.firstNameHash,
          last_name_hash: capi.lastNameHash,
          product_name: parsed.productName,
          product_id: parsed.productId,
          value: parsed.value,
          currency: parsed.currency,
          status: "approved",
          // Momento da APROVAÇÃO (data efetiva da venda no dashboard —
          // migration 016). Só setado aqui: o guard de idempotência por
          // meta_event_id garante que retries não sobrescrevem a primeira
          // aprovação, e refund não mexe nesta coluna.
          approved_at: new Date().toISOString(),
          payment_method: parsed.paymentMethod,
          // Origem real da venda: 'luminar-pay' quando o payload é da Luminar,
          // senão 'payt'. (source é "payt"|"luminar-pay" aqui — body já validado.)
          source,
          affiliate_email: parsed.affiliateEmail,
          matched_lead: !!lead,
          // Snapshot da atribuição no momento da venda (last-touch). Imutável
          // mesmo se o lead for atualizado depois — preserva histórico fiel
          // de qual campanha gerou a conversão.
          campaign_id:   lead?.campaign_id   ?? null,
          campaign_name: lead?.campaign_name ?? null,
          adset_id:      lead?.adset_id      ?? null,
          adset_name:    lead?.adset_name    ?? null,
          ad_id:         lead?.ad_id         ?? null,
          ad_name:       lead?.ad_name       ?? null,
          ad_account_id: lead?.ad_account_id ?? null,
          meta_event_id: capi.metaEventId,
          response_meta: capi.aggregatedResponse,
          raw_webhook: body,
        },
        { onConflict: "transaction_id" },
      );

    if (purchaseError) {
      console.error("[webhook/payt] upsert purchase failed:", purchaseError);
    }

    await recordWebhook("accepted", "approved", 200, parsed.transaction_id);
    return NextResponse.json({
      success: true,
      matched_lead: !!lead,
      capi_sent: capi.fanOutCount,
    });
  } catch (err) {
    console.error("[webhook/payt]", err);
    await recordWebhook("rejected", "error", 500);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
