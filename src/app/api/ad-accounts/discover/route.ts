import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { fetchAdAccountNames } from "@/lib/facebook-ads";

/**
 * POST /api/ad-accounts/discover
 * Body: { bm_id, access_token, account_ids: string[] | string }
 *
 * Pra cada account_id da lista, busca o nome no Graph API (em paralelo).
 * Marca também quais já estão cadastradas no banco. Não cria nada — só
 * pré-popula a tela de bulk import com os dados resolvidos.
 *
 * Aceita account_ids como array OU string separada por vírgula/quebra de
 * linha (UX da UI: usuário cola lista do clipboard).
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const bm_id = String(body.bm_id || "").trim();
  const access_token = String(body.access_token || "").trim();
  const raw = body.account_ids;

  if (!bm_id || !access_token) {
    return NextResponse.json(
      { error: "bm_id e access_token são obrigatórios" },
      { status: 400 },
    );
  }

  // Aceita array OU string separada por vírgula/newline/espaço
  const ids = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\s\n]+/))
    .map((s: string) => String(s).trim().replace(/^act_/, ""))
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "account_ids vazio — cole ao menos 1 ID" },
      { status: 400 },
    );
  }

  // Resolve nomes em paralelo
  const resolved = await fetchAdAccountNames(ids, access_token);

  // Marca já cadastradas
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("ad_accounts")
    .select("account_id")
    .in("account_id", ids);
  const existingSet = new Set(
    (existing ?? []).map(r => (r as { account_id: string }).account_id),
  );

  return NextResponse.json({
    accounts: resolved.map(r => ({
      account_id: r.account_id,
      name: r.name,
      currency: r.currency ?? "BRL",   // moeda nativa da conta (Graph)
      error: r.error,
      already_registered: existingSet.has(r.account_id),
    })),
  });
}
