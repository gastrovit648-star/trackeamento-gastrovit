import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { normalizePhoneBR } from "@/lib/phone";
import { sendOrderPurchaseCAPI } from "@/lib/purchase-capi";
import { getWebhookSecrets } from "@/lib/webhook-secrets";

/**
 * Webhook do Skale Tracking — pedidos Pay-After-Delivery (o cliente paga DEPOIS
 * de receber) e o ciclo de vida deles.
 *
 * Autenticação: `?token=<secret>` na query (ou header `x-skale-secret` pra
 * testes) batendo com o secret do painel (app_settings.webhook_secrets.skale)
 * ou a env SKALE_WEBHOOK_SECRET.
 *
 * O nome do evento fica em `skaletracking.event`. Em vez de mapear evento→status
 * (o Skale dispara MUITOS eventos), a rota computa o ESTADO do pedido a partir
 * do payload (pago? rejeitado? After Pay em aberto?) — é a fonte da verdade e
 * fica idempotente a qualquer evento repetido:
 *
 *   order_created (After Pay, em aberto) → status 'scheduled' (agendamento):
 *     conta na coluna AGENDAMENTO, atribuído por telefone, SEM Purchase no Meta.
 *   pagamento confirmado depois → status 'approved' + Purchase no CAPI (opção A,
 *     mesmo fluxo boleto→pago da Payt). scheduled_at é preservado.
 *   order_rejected → status 'refused' (só atualiza, nunca rebaixa venda paga).
 *
 * Valor vem em CENTAVOS (transaction.total_price). Telefone em customer.phone
 * (normalizePhoneBR põe o DDI 55). transaction_id é o id do pedido.
 */

interface SkaleParsed {
  transaction_id: string | null;
  event: string;
  test: boolean;
  status: "approved" | "refused" | "pending" | "scheduled";
  phoneRaw: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  value: number;
  currency: string;
  paymentMethod: "credit_card" | "boleto" | "pix" | null;
  productName: string | null;
  productId: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSkale(body: any): SkaleParsed {
  const transaction_id = body?.transaction_id ?? body?.skaletracking?.id_venda ?? null;
  const event = String(body?.skaletracking?.event ?? body?.event ?? "").toLowerCase();
  const test = body?.test === true;

  const customer = body?.customer ?? {};
  const phoneRaw = customer?.phone ?? body?.phone ?? null;
  const email = (customer?.email ?? null) || null;
  const fullName: string | null = customer?.name ?? null;
  const [firstName, ...rest] = (fullName ?? "").trim().split(/\s+/);
  const lastName = rest.length ? rest.join(" ") : null;

  // Valor em CENTAVOS — transaction.total_price (fallback product.price).
  const cents = Number(body?.transaction?.total_price) || Number(body?.product?.price) || 0;
  const value = cents > 0 ? cents / 100 : 0;
  const currency = String(body?.transaction?.currency ?? "BRL").toUpperCase();

  const methodRaw = String(body?.transaction?.payment_method ?? "").toLowerCase();
  let paymentMethod: SkaleParsed["paymentMethod"] = null;
  if (methodRaw.includes("pix")) paymentMethod = "pix";
  else if (methodRaw.includes("boleto") || methodRaw.includes("bank_slip") || methodRaw.includes("billet")) paymentMethod = "boleto";
  else if (methodRaw.includes("card") || methodRaw.includes("credit") || methodRaw.includes("cartao") || methodRaw.includes("cartão")) paymentMethod = "credit_card";
  // "After Pay" (e afins) → null: não é boleto/PIX/cartão. Não conta nessas colunas.

  // ── Estado do pedido a partir do payload ───────────────────────────────────
  const payStatus = String(
    body?.transaction?.payment_status ?? body?.skaletracking?.status_pagamento ?? "",
  ).toLowerCase();
  const paidAt = body?.transaction?.paid_at ?? null;
  const isAfterPay =
    methodRaw.includes("after") || methodRaw.includes("delivery") || methodRaw.includes("entrega");
  const isPaid =
    !!paidAt ||
    ["payment_confirmed", "payment_registered", "order_paid_manual", "order_approved"].includes(event) ||
    ["pago", "paid", "confirmado", "confirmed", "aprovado", "approved"].some(s => payStatus.includes(s));
  // Cancelamento/rejeição/estorno — reconhece pelo NOME do evento (order_rejected,
  // order_canceled, order_cancelled, order_refunded, order_chargeback, …) OU pelo
  // status de pagamento. Sem o match por evento, um cancelamento de agendamento
  // passava batido e a linha ficava 'scheduled' (duplicando no cancela-e-refaz).
  const isRejected =
    ["reject", "cancel", "refund", "chargeback", "estorn", "reembols", "devolv"].some(s => event.includes(s)) ||
    ["rejeitado", "reprovado", "rejected", "recusado", "refused", "cancelado", "cancelled", "canceled", "estornado", "refunded", "chargeback"].some(s => payStatus.includes(s));

  let status: SkaleParsed["status"];
  if (isRejected) status = "refused";
  else if (isPaid) status = "approved";
  else if (isAfterPay) status = "scheduled";
  else status = "pending";

  const addr = customer?.address ?? {};
  const city = addr?.city ?? null;
  const state = addr?.state ?? addr?.uf ?? null;
  const country = addr?.country ?? "BR";
  const zip = addr?.zip_code ?? addr?.zipcode ?? addr?.cep ?? null;

  return {
    transaction_id: transaction_id ? String(transaction_id) : null,
    event,
    test,
    status,
    phoneRaw: phoneRaw ? String(phoneRaw) : null,
    email,
    firstName: firstName || null,
    lastName,
    value,
    currency,
    paymentMethod,
    productName: body?.product?.name ?? null,
    productId: body?.product?.code ? String(body.product.code) : null,
    city: city ? String(city) : null,
    state: state ? String(state) : null,
    country: country ? String(country) : null,
    zip: zip ? String(zip) : null,
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
        source: "skale",
        endpoint: "/api/webhook/skale",
        outcome,
        reason,
        http_status: httpStatus,
        transaction_id: transactionId,
        payload: parseError ? { raw: rawText } : body,
      });
    } catch (e) {
      console.error("[webhook/skale] webhook_log insert falhou:", e);
    }
  };

  try {
    const secret =
      request.headers.get("x-skale-secret") ??
      request.nextUrl.searchParams.get("token");
    const { skale: expected } = await getWebhookSecrets();
    if (!secret || !expected.value || secret !== expected.value) {
      await recordWebhook("rejected", "unauthorized", 401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (parseError || body === null) {
      await recordWebhook("rejected", "parse_error", 400);
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseSkale(body);

    // Eventos que não representam pedido/pagamento → ignora (200 pra não retriar).
    if (parsed.test || parsed.event === "test_mapping" || parsed.event === "carrinho_abandonado") {
      await recordWebhook("rejected", `ignored_event:${parsed.event || "test"}`, 200, parsed.transaction_id);
      return NextResponse.json({ ignored: "event", event: parsed.event });
    }
    if (!parsed.transaction_id) {
      await recordWebhook("rejected", "no_transaction_id", 200);
      return NextResponse.json({ ignored: "no_transaction_id" });
    }

    const phone = normalizePhoneBR(parsed.phoneRaw);

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

    // Estado atual da linha — guard de não-rebaixamento + scheduled_at persistente.
    const { data: existingRow } = await supabase
      .from("purchases")
      .select("status, scheduled_at, meta_event_id, capi_scheduled_at")
      .eq("transaction_id", parsed.transaction_id)
      .maybeSingle();
    const existing = existingRow as
      | { status: string; scheduled_at: string | null; meta_event_id: string | null; capi_scheduled_at: string | null }
      | null;
    const isFinal = existing?.status === "approved" || existing?.status === "refunded";

    // ── Rejeitado → só marca refused, nunca rebaixa venda já paga ─────────────
    if (parsed.status === "refused") {
      if (existing && !isFinal) {
        await supabase.from("purchases").update({ status: "refused" }).eq("transaction_id", parsed.transaction_id);
      }
      await recordWebhook("accepted", "status_only:refused", 200, parsed.transaction_id);
      return NextResponse.json({ success: true, status_only: "refused", matched: !!existing });
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

    // ── Scheduled (agendamento) / Pending → grava atribuição, SEM CAPI ───────
    if (parsed.status === "scheduled" || parsed.status === "pending") {
      if (isFinal) {
        // Retry atrasado não pode rebaixar uma venda já finalizada.
        await recordWebhook("accepted", `stale_status:${parsed.status}`, 200, parsed.transaction_id);
        return NextResponse.json({ success: true, stale_status: parsed.status });
      }
      // scheduled_at PERSISTENTE: carimba na 1ª vez que é agendado; preservado
      // depois (mesmo virando pending/approved). A coluna AGENDAMENTO conta por ele.
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
          source: "skale",
          // Agendamento ainda não tem método de pagamento (paga na entrega) —
          // força null pra não contar nas colunas Boleto/PIX.
          payment_method: parsed.status === "scheduled" ? null : parsed.paymentMethod,
          scheduled_at: scheduledAt,
          ...attribution,
          raw_webhook: body,
        },
        { onConflict: "transaction_id" },
      );
      if (error) {
        console.error("[webhook/skale] upsert falhou:", error);
        await recordWebhook("rejected", `${parsed.status}_upsert_error`, 500, parsed.transaction_id);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // ── Purchase no AGENDAMENTO (por pixel) ─────────────────────────────
      // Dispara pros pixels com capi_mode 'schedule'/'both'. capi_scheduled_at
      // é o guard de idempotência; NÃO seta meta_event_id (esse é da venda).
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
          eventSourceUrl: "https://skaletracking.com/checkout",
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

    // ── Approved (pago) → idempotência + Purchase no CAPI (fan-out) ──────────
    if (existing?.meta_event_id) {
      // Purchase já enviado (ex.: agendamento com purchase_on_schedule). Promove
      // o agendamento pago pra approved (receita entra no dashboard) sem reenviar.
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
      eventSourceUrl: "https://skaletracking.com/checkout",
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
        // Momento da aprovação (data efetiva da venda — migration 016).
        // scheduled_at NÃO entra aqui: se o pedido era agendado, o upsert não
        // toca a coluna e o carimbo original é preservado.
        approved_at: new Date().toISOString(),
        payment_method: parsed.paymentMethod,
        source: "skale",
        ...attribution,
        meta_event_id: capi.metaEventId,
        response_meta: capi.aggregatedResponse,
        raw_webhook: body,
      },
      { onConflict: "transaction_id" },
    );
    if (purchaseError) {
      console.error("[webhook/skale] upsert purchase failed:", purchaseError);
    }

    await recordWebhook("accepted", "approved", 200, parsed.transaction_id);
    return NextResponse.json({ success: true, matched_lead: !!lead, capi_sent: capi.fanOutCount });
  } catch (err) {
    console.error("[webhook/skale]", err);
    await recordWebhook("rejected", "error", 500);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
