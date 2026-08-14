import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/ad-accounts/bulk
 * Body: { bm_id, access_token, accounts: [{ account_id, name }] }
 *
 * Cadastra várias ad accounts da mesma BM em batch (mesmo BM ID + token,
 * cada uma com seu account_id + name). Pula account_ids já existentes
 * (ON CONFLICT do unique account_id) — o cliente já sinaliza isso via
 * /discover, mas a defesa extra evita race condition.
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const bm_id = String(body.bm_id || "").trim();
  const access_token = String(body.access_token || "").trim();
  const accountsRaw = Array.isArray(body.accounts) ? body.accounts : [];

  if (!bm_id || !access_token || accountsRaw.length === 0) {
    return NextResponse.json(
      { error: "bm_id, access_token e accounts (array não vazio) são obrigatórios" },
      { status: 400 },
    );
  }

  interface BulkRow {
    bm_id: string;
    access_token: string;
    account_id: string;
    name: string;
    currency: "BRL" | "USD";
    is_active: boolean;
  }
  const rows: BulkRow[] = accountsRaw
    .map((a: { account_id?: unknown; name?: unknown; currency?: unknown }): BulkRow => ({
      bm_id,
      access_token,
      account_id: String(a.account_id ?? "").replace(/^act_/, "").trim(),
      name: String(a.name ?? "").trim(),
      // Moeda detectada no /discover (campo currency da conta no Meta).
      // Default BRL se vier ausente ou inválida.
      currency: String(a.currency ?? "").toUpperCase() === "USD" ? "USD" : "BRL",
      is_active: true,
    }))
    .filter((r: BulkRow) => r.account_id && r.name);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma account_id+name válida no array" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  // upsert por account_id — atualiza token/nome se já existir
  const { data, error } = await supabase
    .from("ad_accounts")
    .upsert(rows, { onConflict: "account_id" })
    .select("id, bm_id, account_id, name, currency, is_active, created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data, count: data?.length ?? 0 });
}
