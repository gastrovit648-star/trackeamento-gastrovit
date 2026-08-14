import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const onlyActive = request.nextUrl.searchParams.get("active") === "true";
  const supabase = createAdminClient();
  let query = supabase
    .from("products")
    .select("id, product_id, name, value, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (onlyActive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const product_id = String(body.product_id || "").trim();
  const name       = String(body.name || "").trim();
  const value      = Number(body.value);
  const is_active  = body.is_active === false ? false : true;

  if (!product_id || !name) {
    return NextResponse.json(
      { error: "product_id e name são obrigatórios" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: "value deve ser um número positivo" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ product_id, name, value, is_active })
    .select("id, product_id, name, value, is_active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
