import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.email === "string")    patch.email = body.email.trim().toLowerCase();
  if (typeof body.name === "string")     patch.name = body.name.trim();
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if ("project_ids" in body)             patch.project_ids = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("attendants")
    .update(patch)
    .eq("id", params.id)
    .select("id, email, name, is_active, project_ids, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("attendants")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
