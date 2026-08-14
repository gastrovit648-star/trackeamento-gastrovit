import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { fetchAdAccountNames } from "@/lib/facebook-ads";

/**
 * POST /api/ad-accounts/refresh-currency
 *
 * Re-detecta a moeda (BRL/USD) de TODAS as contas cadastradas consultando o
 * campo `currency` da Graph API com o token de cada conta, e atualiza a coluna
 * `currency` quando mudou.
 *
 * Uso principal: backfill único após a migration 012 (contas legadas nasceram
 * com default 'BRL'). Pode ser re-rodado a qualquer momento sem efeito colateral.
 */
export async function POST() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data: accounts, error } = await supabase
    .from("ad_accounts")
    .select("id, account_id, access_token, currency");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (accounts ?? []) as Array<{
    id: string; account_id: string; access_token: string; currency: string;
  }>;

  const results = await Promise.all(
    rows.map(async (acc) => {
      const [meta] = await fetchAdAccountNames([acc.account_id], acc.access_token);
      const detected = meta?.currency ?? null;
      if (!detected) {
        return { account_id: acc.account_id, status: "unresolved" as const, error: meta?.error ?? null };
      }
      if (detected === acc.currency) {
        return { account_id: acc.account_id, status: "unchanged" as const, currency: detected };
      }
      const { error: upErr } = await supabase
        .from("ad_accounts")
        .update({ currency: detected })
        .eq("id", acc.id);
      if (upErr) {
        return { account_id: acc.account_id, status: "error" as const, error: upErr.message };
      }
      return { account_id: acc.account_id, status: "updated" as const, from: acc.currency, to: detected };
    }),
  );

  const updated = results.filter(r => r.status === "updated").length;
  return NextResponse.json({ updated, total: rows.length, results });
}
