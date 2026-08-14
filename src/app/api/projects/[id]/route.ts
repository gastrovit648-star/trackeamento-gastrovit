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
  if (typeof body.name === "string") patch.name = body.name.trim();

  if (Object.keys(patch).length === 0 || patch.name === "") {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", params.id)
    .select("id, name, created_at")
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

  // Antes de apagar, tira o projeto de todas as entidades:
  //  1. Remove o id de cada array project_ids (membership real — migration 021).
  //  2. Zera o project_id vestigial (coluna deprecada da 020 ainda tem FK sem
  //     ON DELETE; sem isso o delete violaria a constraint).
  const tables = ["ad_accounts", "pixels", "attendants"] as const;
  for (const t of tables) {
    const { data: rows } = await supabase
      .from(t)
      .select("id, project_ids")
      .contains("project_ids", [params.id]);
    for (const r of (rows ?? []) as Array<{ id: string; project_ids: string[] }>) {
      await supabase
        .from(t)
        .update({ project_ids: r.project_ids.filter(x => x !== params.id) })
        .eq("id", r.id);
    }
    await supabase.from(t).update({ project_id: null }).eq("project_id", params.id);
  }

  const { error } = await supabase.from("projects").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
