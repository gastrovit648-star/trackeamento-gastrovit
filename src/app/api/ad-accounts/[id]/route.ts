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
  if (typeof body.bm_id === "string")        patch.bm_id = body.bm_id.trim();
  if (typeof body.account_id === "string")   patch.account_id = body.account_id.trim().replace(/^act_/, "");
  if (typeof body.name === "string")         patch.name = body.name.trim();
  if (typeof body.access_token === "string") patch.access_token = body.access_token.trim();
  if (typeof body.is_active === "boolean")   patch.is_active = body.is_active;
  // project_ids: array completo de projetos aos quais a conta pertence
  // (migration 021). "project_ids" in body distingue "não mexer" de "setar".
  if ("project_ids" in body)                 patch.project_ids = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ad_accounts")
    .update(patch)
    .eq("id", params.id)
    .select("id, bm_id, account_id, name, is_active, project_ids, created_at")
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
    .from("ad_accounts")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
