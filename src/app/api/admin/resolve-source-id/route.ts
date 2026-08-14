import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/admin/resolve-source-id?source_id=120253138129460001
 *
 * Diagnóstico do resolvedor de contexto CTWA. Tenta resolver o source_id em
 * TODAS as contas ativas (mesma ordem que o webhook DataCrazy usa) e retorna
 * por conta:
 *   - tentativa em /{id} como ad     (shape mais completo + creative)
 *   - tentativa em /{id} como adset
 *   - tentativa em /{id} como campaign
 *
 * Cada tentativa expõe a resposta crua da Graph (data ou error). Use quando
 * um lead chegar com source_id mas sem campaign/adset/ad atribuídos — vai
 * mostrar exatamente qual conta deveria ter resolvido e por que falhou.
 */

const GRAPH_API_VERSION = "v19.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchGraph(url: string): Promise<{ data: any; error: string | null }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.error) {
      return { data: null, error: `${data.error.code ?? "?"}: ${data.error.message ?? "Erro Meta"}` };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: `Network: ${String(err)}` };
  }
}

export async function GET(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const sourceId = request.nextUrl.searchParams.get("source_id");
  if (!sourceId) {
    return NextResponse.json(
      { error: "Faltando query param 'source_id'" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("ad_accounts")
    .select("id, bm_id, account_id, name, access_token")
    .eq("is_active", true);

  type Row = { id: string; bm_id: string; account_id: string; name: string; access_token: string };
  const rows = (accounts ?? []) as Row[];

  const results = await Promise.all(
    rows.map(async a => {
      const asAd = await fetchGraph(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
          `?fields=id,name,account_id,adset{id,name,campaign{id,name}},` +
          `creative{object_story_spec{page_id},effective_object_story_id}` +
          `&access_token=${a.access_token}`,
      );
      const asAdset = await fetchGraph(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
          `?fields=id,name,account_id,campaign{id,name}` +
          `&access_token=${a.access_token}`,
      );
      const asCampaign = await fetchGraph(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
          `?fields=id,name,account_id&access_token=${a.access_token}`,
      );

      const resolved =
        (asAd.data && asAd.data.adset?.campaign && "ad") ||
        (asAdset.data && asAdset.data.campaign && "adset") ||
        (asCampaign.data && asCampaign.data.id && "campaign") ||
        null;

      return {
        bm_id: a.bm_id,
        account_id: a.account_id,
        name: a.name,
        resolved_as: resolved,
        as_ad: asAd,
        as_adset: asAdset,
        as_campaign: asCampaign,
      };
    }),
  );

  const winners = results.filter(r => r.resolved_as);

  return NextResponse.json({
    source_id: sourceId,
    accounts_tried: results.length,
    accounts_resolved: winners.length,
    winners: winners.map(w => ({
      account_id: w.account_id,
      name: w.name,
      resolved_as: w.resolved_as,
    })),
    details: results,
  });
}
