import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { normalizePhoneBR } from "@/lib/phone";
import { sha256 } from "@/lib/hash";

/**
 * Exclusão de venda — remove uma purchase do dashboard (uso: venda lançada
 * errada, duplicada, teste). Autenticado por sessão (requireAuth).
 *
 * events_log NÃO tem FK para purchases (correlaciona por phone/event_id texto),
 * então não há cascade — só a linha de purchases é removida. Os eventos CAPI
 * já enviados ao Meta não são desfeitos; esta ação apenas limpa o dashboard.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("purchases")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

/**
 * Correção de telefone + re-match de uma venda — usado pelo botão "Corrigir
 * telefone" no drawer quando o cliente digitou o número errado no checkout e a
 * venda entrou sem atribuição (matched_lead=false). Reproduz a MESMA lógica do
 * webhook Payt/Luminar: normaliza (normalizePhoneBR), recalcula o phone_hash
 * (sha256) e busca o lead pelo número corrigido pra herdar a atribuição.
 *
 * Body: { phone: string, allowNoMatch?: boolean }
 *
 * Sem lead com o número corrigido e sem allowNoMatch → 409 { no_lead }, pra o
 * botão perguntar se o operador quer corrigir o telefone mesmo assim (venda
 * fica sem campanha). Com allowNoMatch, atualiza só phone/phone_hash.
 *
 * Como o webhook do Meta CAPI já foi disparado com o telefone errado no momento
 * da compra, isto NÃO reenvia o evento — corrige só o match interno (dashboard).
 * approved_at, value e status ficam intactos: nada de faturamento muda, só a
 * atribuição.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json().catch(() => ({}));
  const allowNoMatch = body?.allowNoMatch === true;

  const phone = normalizePhoneBR(body?.phone ? String(body.phone) : null);
  if (!phone) {
    return NextResponse.json(
      { error: "Telefone inválido — confira o número (DDD + celular, ex: 27 98129-7433)." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Lead com o número corrigido — fonte da atribuição (mesmo lookup do webhook).
  type LeadRow = {
    campaign_id: string | null;
    campaign_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    ad_id: string | null;
    ad_name: string | null;
    ad_account_id: string | null;
  };
  const { data: leadData } = await supabase
    .from("leads")
    .select("campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, ad_account_id")
    .eq("phone", phone)
    .maybeSingle();
  const lead = (leadData as LeadRow | null) ?? null;

  if (!lead && !allowNoMatch) {
    return NextResponse.json({ no_lead: true, phone }, { status: 409 });
  }

  const patch: Record<string, unknown> = {
    phone,
    phone_hash: await sha256(phone),
  };
  if (lead) {
    patch.matched_lead  = true;
    patch.campaign_id   = lead.campaign_id;
    patch.campaign_name = lead.campaign_name;
    patch.adset_id      = lead.adset_id;
    patch.adset_name    = lead.adset_name;
    patch.ad_id         = lead.ad_id;
    patch.ad_name       = lead.ad_name;
    patch.ad_account_id = lead.ad_account_id;
  }

  const { data: updated, error } = await supabase
    .from("purchases")
    .update(patch)
    .eq("id", params.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    matched: !!lead,
    campaign_name: lead?.campaign_name ?? null,
  });
}
