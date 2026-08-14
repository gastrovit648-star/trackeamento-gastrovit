import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pixels")
    .select("id, pixel_id, name, is_default, capi_mode, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const pixel_id     = String(body.pixel_id || "").trim();
  const access_token = String(body.access_token || "").trim();
  const name         = body.name ? String(body.name).trim() : null;
  const is_default   = body.is_default === true;
  const project_ids  = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (!pixel_id || !access_token) {
    return NextResponse.json(
      { error: "pixel_id e access_token são obrigatórios" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Se este vai ser default, desliga o atual primeiro (constraint partial
  // unique no banco permite só 1 row com is_default=true).
  if (is_default) {
    await supabase.from("pixels").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("pixels")
    .insert({ pixel_id, access_token, name, is_default, project_ids })
    .select("id, pixel_id, name, is_default, capi_mode, project_ids, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
