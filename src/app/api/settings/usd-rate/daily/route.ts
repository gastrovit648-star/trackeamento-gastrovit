import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET → lista as cotações diárias salvas (data desc, mais recentes primeiro). */
export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("usd_brl_rates")
    .select("date, rate, updated_at")
    .order("date", { ascending: false })
    .limit(180);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** PUT → upsert da cotação de um dia ({ date: "YYYY-MM-DD", rate: number }). */
export async function PUT(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const date = String(body.date || "").trim();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Data inválida (use YYYY-MM-DD)." }, { status: 400 });
  }
  const r = Number(String(body.rate).replace(",", "."));
  if (!Number.isFinite(r) || r <= 0) {
    return NextResponse.json(
      { error: "Informe um valor de cotação válido (maior que zero)." },
      { status: 400 },
    );
  }
  const rate = Math.round(r * 10000) / 10000;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("usd_brl_rates")
    .upsert({ date, rate }, { onConflict: "date" })
    .select("date, rate, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/** DELETE ?date=YYYY-MM-DD → remove a cotação de um dia (volta ao fallback). */
export async function DELETE(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Data inválida (use YYYY-MM-DD)." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("usd_brl_rates").delete().eq("date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
