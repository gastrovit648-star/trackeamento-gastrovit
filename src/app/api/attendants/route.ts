import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("attendants")
    .select("id, email, name, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  const name  = body.name ? String(body.name).trim() : null;
  const is_active = body.is_active !== false;
  const project_ids = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Email válido obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("attendants")
    .insert({ email, name, is_active, project_ids })
    .select("id, email, name, is_active, project_ids, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
