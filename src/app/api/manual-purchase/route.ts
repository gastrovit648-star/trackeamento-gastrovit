import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { sha256 } from "@/lib/hash";
import { normalizePhoneBR } from "@/lib/phone";
import { sendMetaCAPIFanOut, type CAPIFanOutResult } from "@/lib/meta-capi";

/**
 * Lançamento manual de vendas — admin registra venda que não veio do gateway
 * (presencial, ajuste, etc). Mesmo fluxo do webhook Payt em termos de CAPI
 * fan-out e snapshot de atribuição, mas:
 *   - autenticado por sessão (requireAuth), não por secret
 *   - source = "manual" na purchase
 *   - transaction_id não-determinístico (cada submit = lançamento novo)
 *   - actionSource = "system_generated" (apropriado pra evento manual)
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const phoneRaw = body.phone ? String(body.phone) : null;
  const email    = body.email ? String(body.email).trim().toLowerCase() : null;
  const nameRaw  = body.name  ? String(body.name).trim() : null;
  const country  = body.country ? String(body.country) : "BR";
  const state    = body.state   ? String(body.state)   : null;
  const city     = body.city    ? String(body.city)    : null;
  const zip      = body.zip     ? String(body.zip)     : null;
  const product_id   = body.product_id   ? String(body.product_id)   : null;
  const product_name = body.product_name ? String(body.product_name) : null;
  const value = Number(body.value);

  const phone = normalizePhoneBR(phoneRaw);

  // Telefone digitado mas impossível de normalizar: recusa em vez de gravar
  // phone=null. Gravar mudo custa caro — a venda entra sem match com o lead do
  // DataCrazy (logo, sem atribuição de campanha) e o operador vê "Venda
  // registrada" achando que deu certo. Melhor devolver erro e deixar corrigir.
  // Cliente sem telefone brasileiro: deixar o campo vazio e usar o e-mail.
  if (phoneRaw && phoneRaw.trim() && !phone) {
    return NextResponse.json(
      {
        error:
          "Telefone inválido — confira o número. Esperado DDD + celular " +
          "(ex: 11 98765-4321). Se o cliente não tem telefone brasileiro, " +
          "deixe o campo vazio e informe o e-mail.",
      },
      { status: 400 },
    );
  }

  // Validação mínima
  if (!phone && !email) {
    return NextResponse.json(
      { error: "phone ou email é obrigatório" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: "value deve ser um número positivo" },
      { status: 400 },
    );
  }

  // Split do nome — primeira palavra = firstName, resto = lastName.
  // Mesmo padrão do parsePayt() no webhook Payt.
  const nameParts = nameRaw ? nameRaw.split(/\s+/).filter(Boolean) : [];
  const firstName = nameParts[0] || null;
  const lastName  = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const supabase = createAdminClient();

  // Lookup lead pra herdar atribuição (campaign/adset/ad/ad_account + ctwa_clid).
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

  // Pixels ativos pro fan-out (mesmo padrão dos webhooks Payt/DataCrazy).
  const { data: pixelsRows } = await supabase
    .from("pixels")
    .select("pixel_id, access_token")
    .eq("is_active", true);
  const activePixels = (pixelsRows ?? []) as Array<{
    pixel_id: string;
    access_token: string;
  }>;

  // Hashes PII (sendMetaCAPI já hashea internamente, mas armazenamos no purchases).
  const phoneHash     = phone     ? await sha256(phone)                  : null;
  const emailHash     = email     ? await sha256(email)                  : null;
  const firstNameHash = firstName ? await sha256(firstName.toLowerCase()) : null;
  const lastNameHash  = lastName  ? await sha256(lastName.toLowerCase())  : null;

  // transaction_id não-determinístico — cada submit é um lançamento novo.
  // Admin não reprocessa, então não há valor em dedup baseada em conteúdo.
  const randomId = Math.random().toString(36).slice(2, 14).padEnd(12, "0");
  const transaction_id = `manual-${randomId}`;
  const metaEventId    = await sha256(`purchase:manual:${transaction_id}`);

  // ── Envia Purchase via CAPI (fan-out paralelo) ────────────────────────────
  let fanOutResults: CAPIFanOutResult[] = [];
  if (activePixels.length > 0) {
    fanOutResults = await sendMetaCAPIFanOut(
      {
        eventName: "Purchase",
        eventId: metaEventId,
        // system_generated é o action_source documentado pela Meta pra eventos
        // disparados manualmente pelo backoffice (ajustes, lançamento offline).
        actionSource: "system_generated",
        userData: {
          email,
          phone,
          firstName,
          lastName,
          externalId: phone ?? email ?? undefined,
          city,
          state,
          country,
          zip,
          ctwa_clid: lead?.ctwa_clid ?? null,
        },
        customData: {
          value,
          currency: "BRL",
          content_name: product_name ?? undefined,
          content_ids: product_id ? [product_id] : undefined,
        },
      },
      activePixels.map(p => ({ pixelId: p.pixel_id, accessToken: p.access_token })),
    );
  }

  // Agrega responses por pixel pra purchases.response_meta.
  const aggregatedResponse: Record<string, unknown> =
    fanOutResults.length > 0
      ? Object.fromEntries(fanOutResults.map(r => [r.pixelId, r.response]))
      : { skipped: "no_active_pixels" };

  // ── Insert purchase ───────────────────────────────────────────────────────
  const { error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      transaction_id,
      source: "manual",
      phone,
      phone_hash: phoneHash,
      email,
      email_hash: emailHash,
      first_name_hash: firstNameHash,
      last_name_hash: lastNameHash,
      product_name,
      product_id,
      value,
      currency: "BRL",
      status: "approved",
      // Venda manual já nasce aprovada — approved_at = agora (migration 016).
      approved_at: new Date().toISOString(),
      affiliate_email: null,
      matched_lead: !!lead,
      campaign_id:   lead?.campaign_id   ?? null,
      campaign_name: lead?.campaign_name ?? null,
      adset_id:      lead?.adset_id      ?? null,
      adset_name:    lead?.adset_name    ?? null,
      ad_id:         lead?.ad_id         ?? null,
      ad_name:       lead?.ad_name       ?? null,
      ad_account_id: lead?.ad_account_id ?? null,
      meta_event_id: metaEventId,
      response_meta: aggregatedResponse,
      raw_webhook: { source: "manual", input: body },
    });

  if (purchaseError) {
    console.error("[api/manual-purchase] insert failed:", purchaseError);
    return NextResponse.json(
      { error: purchaseError.message },
      { status: 500 },
    );
  }

  // ── Batch insert events_log (1 row por pixel) ─────────────────────────────
  if (fanOutResults.length > 0) {
    await supabase.from("events_log").insert(
      fanOutResults.map(r => ({
        phone,
        event_name: "Purchase",
        event_id: metaEventId,
        pixel_id: r.pixelId,
        payload_meta: r.sentPayload,
        response_meta: r.response,
      })),
    );
  }

  return NextResponse.json({
    success: true,
    transaction_id,
    matched_lead: !!lead,
    capi_sent: fanOutResults.length,
  });
}
