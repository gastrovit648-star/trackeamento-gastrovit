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
  if (typeof body.pixel_id === "string")      patch.pixel_id = body.pixel_id.trim();
  if (typeof body.access_token === "string")  patch.access_token = body.access_token.trim();
  if (typeof body.name === "string")          patch.name = body.name.trim();
  if (typeof body.is_default === "boolean")   patch.is_default = body.is_default;
  if (typeof body.capi_mode === "string" && ["sale", "schedule", "both", "off"].includes(body.capi_mode)) {
    patch.capi_mode = body.capi_mode;
  }
  if ("project_ids" in body)                  patch.project_ids = Array.isArray(body.project_ids) ? body.project_ids.map(String) : [];

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (patch.is_default === true) {
    await supabase
      .from("pixels")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", params.id);
  }

  const { data, error } = await supabase
    .from("pixels")
    .update(patch)
    .eq("id", params.id)
    .select("id, pixel_id, name, is_default, capi_mode, project_ids, created_at")
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
    .from("pixels")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
