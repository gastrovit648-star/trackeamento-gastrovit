import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { normalizePhoneBR } from "@/lib/phone";
import { sendOrderPurchaseCAPI } from "@/lib/purchase-capi";
import { getWebhookSecrets } from "@/lib/webhook-secrets";

/**
 * Webhook de postback da Braip — vendas normais E "pagamento na entrega" /
 * Cash on Delivery (o modelo Pay-After-Delivery, mesmo fluxo do Skale/Luminar).
 *
 * Autenticação: a Braip envia `basic_authentication` NO CORPO de cada postback
 * (não em header/query). Comparamos com o secret do painel
 * (app_settings.webhook_secrets.braip) ou a env BRAIP_WEBHOOK_SECRET. O
 * `?token=` continua aceito só pra testes via curl.
 *
 * Estado do pedido a partir do payload (fonte da verdade, idempotente a repetição):
 *   trans_pay_on_delivery=1 / trans_cash_on_delivery=true / status "Agendado" (11)
 *     e ainda não pago → 'scheduled' (agendamento): coluna AGENDAMENTO, atribuído
 *     por telefone, SEM Purchase no Meta (opção A).
 *   "Pagamento Aprovado" (2) → 'approved' + Purchase no CAPI. scheduled_at é
 *     preservado (se o pedido era agendado, conta também no comprometido).
 *   Cancelada(3)/Chargeback(4)/Devolvida(5)/Estorno Pendente(7) → 'refunded';
 *     Frustrada(12) → 'refused' (só atualiza, nunca rebaixa venda paga).
 *   DELIVERY_RESCHEDULED → reagendamento de entrega: no-op nas métricas (o mesmo
 *     trans_key, então não duplica).
 *
 * Valor em CENTAVOS: comissão do produtor (senão trans_value). Telefone em
 * client_cel (normalizePhoneBR põe o DDI 55). trans_key é o id da transação.
 */

interface BraipParsed {
  transaction_id: string | null;
  type: string;
  isReschedule: boolean;
  status: "approved" | "refused" | "refunded" | "pending" | "scheduled";
  phoneRaw: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  value: number;
  currency: string;
  paymentMethod: "credit_card" | "boleto" | "pix" | null;
  productName: string | null;
  productId: string | null;
  affiliateEmail: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseBraip(body: any): BraipParsed {
  const type = String(body?.type ?? "").toUpperCase();
  const isReschedule = type === "DELIVERY_RESCHEDULED";
  const transaction_id = body?.trans_key ?? null;

  const code = Number(body?.trans_status_code) || 0;
  const statusText = String(body?.trans_status ?? "").toLowerCase();

  // Pay-After-Delivery: pago depois de receber (1) ou na entrega (COD).
  const payOnDelivery = body?.trans_pay_on_delivery === 1 || body?.trans_pay_on_delivery === "1";
  const cashOnDelivery = body?.trans_cash_on_delivery === true;
  const isAfterPay = payOnDelivery || cashOnDelivery;

  // Método (trans_payment): 1/3=boleto, 5=pix, 2/8/9=cartão. 6/7=entrega/COD e
  // 4=grátis → null (agendamento não tem método; não conta em Boleto/PIX).
  const pay = Number(body?.trans_payment) || 0;
  let paymentMethod: BraipParsed["paymentMethod"] = null;
  if (pay === 5) paymentMethod = "pix";
  else if (pay === 1 || pay === 3) paymentMethod = "boleto";
  else if (pay === 2 || pay === 8 || pay === 9) paymentMethod = "credit_card";

  let status: BraipParsed["status"];
  if (code === 2 || statusText.includes("aprovad")) status = "approved";
  else if ([3, 4, 5, 7].includes(code) || ["cancel", "devolv", "chargeback", "estorn"].some(s => statusText.includes(s))) status = "refunded";
  else if (code === 12 || statusText.includes("frustrad")) status = "refused";
  else if (code === 11 || isAfterPay || statusText.includes("agendad")) status = "scheduled";
  else status = "pending"; // 1, 6, 8, 9, 10

  // Valor em centavos: comissão do produtor (net) se houver, senão trans_value.
  const commissions: Array<{ type?: string; value?: string | number; email?: string }> =
    Array.isArray(body?.commissions) ? body.commissions : [];
  const producer = commissions.find(c => String(c?.type ?? "").toLowerCase().includes("produtor"));
  const producerCents = producer?.value ? Number(producer.value) : 0;
  const transCents = Number(body?.trans_value) || 0;
  const cents = producerCents > 0 ? producerCents : transCents;
  const value = cents > 0 ? cents / 100 : 0;

  const currency = String(body?.currency ?? "BRL").toUpperCase();

  const affiliate = commissions.find(c => String(c?.type ?? "").toLowerCase().includes("afiliado"));
  const affiliateEmail = affiliate?.email ? String(affiliate.email).toLowerCase() : null;

  const fullName: string | null = body?.client_name ?? null;
  const [firstName, ...rest] = (fullName ?? "").trim().split(/\s+/);
  const lastName = rest.length ? rest.join(" ") : null;

  return {
    transaction_id: transaction_id ? String(transaction_id) : null,
    type,
    isReschedule,
    status,
    phoneRaw: body?.client_cel != null ? String(body.client_cel) : null,
    email: (body?.client_email ?? null) || null,
    firstName: firstName || null,
    lastName,
    value,
    currency,
    paymentMethod,
    productName: body?.product_name ?? null,
    productId: body?.product_key ? String(body.product_key) : null,
    affiliateEmail,
    city: body?.client_address_city ? String(body.client_address_city) : null,
    state: body?.client_address_state ? String(body.client_address_state) : null,
    country: body?.client_address_country ? String(body.client_address_country) : "BR",
    zip: body?.client_zip_code ? String(body.client_zip_code) : null,
  };
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  const rawText = await request.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  let parseError = false;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    parseError = true;
  }

  const recordWebhook = async (
    outcome: "accepted" | "rejected",
    reason: string,
    httpStatus: number,
    transactionId: string | null = null,
  ) => {
    try {
      await supabase.from("webhook_log").insert({
        source: "braip",
        endpoint: "/api/webhook/braip",
        outcome,
        reason,
        http_status: httpStatus,
        transaction_id: transactionId,
        payload: parseError ? { raw: rawText } : body,
      });
    } catch (e) {
      console.error("[webhook/braip] webhook_log insert falhou:", e);
    }
  };

  try {
    // Auth: basic_authentication no corpo (caminho oficial) ou ?token= (testes).
    const secret =
      (body && typeof body.basic_authentication === "string" ? body.basic_authentication : null) ??
      request.nextUrl.searchParams.get("token");
    const { braip: expected } = await getWebhookSecrets();
    if (!secret || !expected.value || secret !== expected.value) {
      await recordWebhook("rejected", "unauthorized", 401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (parseError || body === null) {
      await recordWebhook("rejected", "parse_error", 400);
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseBraip(body);

    if (!parsed.transaction_id) {
      await recordWebhook("rejected", "no_transaction_id", 200);
      return NextResponse.json({ ignored: "no_transaction_id" });
    }

    // Reagendamento de entrega: mesma transação, sem mudança de métrica.
    if (parsed.isReschedule) {
      await recordWebhook("accepted", "delivery_rescheduled", 200, parsed.transaction_id);
      return NextResponse.json({ success: true, ignored: "delivery_rescheduled" });
    }

    const phone = normalizePhoneBR(parsed.phoneRaw);

    // Estado atual — guard de não-rebaixamento + scheduled_at persistente.
    const { data: existingRow } = await supabase
      .from("purchases")
      .select("status, scheduled_at, meta_event_id, capi_scheduled_at")
      .eq("transaction_id", parsed.transaction_id)
      .maybeSingle();
    const existing = existingRow as
      | { status: string; scheduled_at: string | null; meta_event_id: string | null; capi_scheduled_at: string | null }
      | null;
    const isFinal = existing?.status === "approved" || existing?.status === "refunded";

    // ── Cancelada / estorno / frustrada → só marca, nunca rebaixa venda paga ──
    if (parsed.status === "refused" || parsed.status === "refunded") {
      if (existing && !(isFinal && existing?.status === "approved")) {
        await supabase.from("purchases").update({ status: parsed.status }).eq("transaction_id", parsed.transaction_id);
      }
      await recordWebhook("accepted", `status_only:${parsed.status}`, 200, parsed.transaction_id);
      return NextResponse.json({ success: true, status_only: parsed.status, matched: !!existing });
    }

    // Lead match por telefone (atribuição last-touch + ctwa_clid pro CAPI).
    type LeadRow = {
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
        .select("ctwa_clid, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name")
        .eq("phone", phone)
        .maybeSingle();
      lead = (data as LeadRow | null) ?? null;
    }
    const attribution = {
      matched_lead: !!lead,
      campaign_id:   lead?.campaign_id   ?? null,
      campaign_name: lead?.campaign_name ?? null,
      adset_id:      lead?.adset_id      ?? null,
      adset_name:    lead?.adset_name    ?? null,
      ad_id:         lead?.ad_id         ?? null,
      ad_name:       lead?.ad_name       ?? null,
      ad_account_id: lead?.ad_account_id ?? null,
    };
    const eventSourceUrl =
      (typeof body?.trans_payment_link_checkout === "string" && body.trans_payment_link_checkout) ||
      "https://ev.braip.com/checkout";

    // ── Scheduled (agendamento) / Pending → grava atribuição, SEM CAPI de venda ─
    if (parsed.status === "scheduled" || parsed.status === "pending") {
      if (isFinal) {
        await recordWebhook("accepted", `stale_status:${parsed.status}`, 200, parsed.transaction_id);
        return NextResponse.json({ success: true, stale_status: parsed.status });
      }
      const scheduledAt =
        parsed.status === "scheduled"
          ? existing?.scheduled_at ?? new Date().toISOString()
          : existing?.scheduled_at ?? null;

      const { error } = await supabase.from("purchases").upsert(
        {
          transaction_id: parsed.transaction_id,
          phone,
          phone_hash: phone ? await sha256(phone) : null,
          email: parsed.email,
          product_name: parsed.productName,
          product_id: parsed.productId,
          value: parsed.value,
          currency: parsed.currency,
          status: parsed.status,
          source: "braip",
          affiliate_email: parsed.affiliateEmail,
          // Agendamento não tem método (paga na entrega) — força null.
          payment_method: parsed.status === "scheduled" ? null : parsed.paymentMethod,
          scheduled_at: scheduledAt,
          ...attribution,
          raw_webhook: body,
        },
        { onConflict: "transaction_id" },
      );
      if (error) {
        console.error("[webhook/braip] upsert falhou:", error);
        await recordWebhook("rejected", `${parsed.status}_upsert_error`, 500, parsed.transaction_id);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Purchase no AGENDAMENTO (por pixel, capi_mode schedule/both). Idempotência
      // por capi_scheduled_at; NÃO seta meta_event_id (esse é o da venda).
      let capiSent = 0;
      if (parsed.status === "scheduled" && !existing?.capi_scheduled_at) {
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
          eventSourceUrl,
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
      return NextResponse.json({ success: true, status_only: parsed.status, matched_lead: !!lead, capi_sent: capiSent });
    }

    // ── Approved (pago) → idempotência + Purchase no CAPI (fan-out) ───────────
    if (existing?.meta_event_id) {
      // Purchase já enviado (ex.: agendamento que disparou schedule com pixel both).
      // Promove o agendamento pago pra approved sem reenviar.
      await supabase
        .from("purchases")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("transaction_id", parsed.transaction_id)
        .eq("status", "scheduled");
      await recordWebhook("accepted", "deduped", 200, parsed.transaction_id);
      return NextResponse.json({ success: true, deduped: true });
    }

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
      eventSourceUrl,
    }, "sale");

    const { error: purchaseError } = await supabase.from("purchases").upsert(
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
        // scheduled_at NÃO entra aqui: se era agendado, o upsert não toca a coluna
        // e o carimbo original é preservado (conta no comprometido também).
        approved_at: new Date().toISOString(),
        payment_method: parsed.paymentMethod,
        source: "braip",
        affiliate_email: parsed.affiliateEmail,
        ...attribution,
        meta_event_id: capi.metaEventId,
        response_meta: capi.aggregatedResponse,
        raw_webhook: body,
      },
      { onConflict: "transaction_id" },
    );
    if (purchaseError) {
      console.error("[webhook/braip] upsert purchase failed:", purchaseError);
    }

    await recordWebhook("accepted", "approved", 200, parsed.transaction_id);
    return NextResponse.json({ success: true, matched_lead: !!lead, capi_sent: capi.fanOutCount });
  } catch (err) {
    console.error("[webhook/braip]", err);
    await recordWebhook("rejected", "error", 500);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
