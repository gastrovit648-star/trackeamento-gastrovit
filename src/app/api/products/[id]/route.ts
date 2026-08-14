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
  if (typeof body.product_id === "string") patch.product_id = body.product_id.trim();
  if (typeof body.name       === "string") patch.name       = body.name.trim();
  if (typeof body.value      === "number" && Number.isFinite(body.value) && body.value > 0) {
    patch.value = body.value;
  }
  if (typeof body.is_active  === "boolean") patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", params.id)
    .select("id, product_id, name, value, is_active, created_at, updated_at")
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
    .from("products")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
