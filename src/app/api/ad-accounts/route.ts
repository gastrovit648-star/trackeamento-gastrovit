import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { fetchAdAccountNames } from "@/lib/facebook-ads";

export async function GET(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  // ?project=<id> escopa o seletor de conta ao projeto ativo (migration 021).
  const projectId = request.nextUrl.searchParams.get("project");

  const supabase = createAdminClient();
  let query = supabase
    .from("ad_accounts")
    .select("id, bm_id, account_id, name, currency, is_active, project_ids, created_at")
    .order("created_at", { ascending: false });
  if (projectId) query = query.contains("project_ids", [projectId]);
  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const bm_id = String(body.bm_id || "").trim();
  const account_id = String(body.account_id || "").trim().replace(/^act_/, "");
  const name = String(body.name || "").trim();
  const access_token = String(body.access_token || "").trim();
  const is_active = body.is_active !== false;
  const project_ids = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (!bm_id || !account_id || !name || !access_token) {
    return NextResponse.json(
      { error: "bm_id, account_id, name, access_token são obrigatórios" },
      { status: 400 },
    );
  }

  // Auto-detecta a moeda da conta no Meta (BRL/USD). Se a Graph falhar,
  // assume BRL — pode ser corrigido depois via /refresh-currency.
  const [meta] = await fetchAdAccountNames([account_id], access_token);
  const currency = meta?.currency ?? "BRL";

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ad_accounts")
    .insert({ bm_id, account_id, name, access_token, currency, is_active, project_ids })
    .select("id, bm_id, account_id, name, currency, is_active, project_ids, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
