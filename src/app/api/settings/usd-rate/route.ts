import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { getUsdRateConfig, fetchLiveUsdToBrlRate } from "@/lib/exchange-rate";

const SETTINGS_KEY = "usd_brl_rate";

/**
 * GET → config atual da cotação + cotação ao vivo (pra exibir o valor de
 * referência mesmo quando o modo manual está ativo).
 */
export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const [config, liveRate] = await Promise.all([
    getUsdRateConfig(),
    fetchLiveUsdToBrlRate(),
  ]);
  return NextResponse.json({ config, liveRate });
}

/**
 * PUT → salva o modo (auto/manual) e, em modo manual, o valor fixo da cotação.
 */
export async function PUT(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const mode: "auto" | "manual" = body.mode === "manual" ? "manual" : "auto";

  let manual_rate: number | null = null;
  if (mode === "manual") {
    const r = Number(body.manual_rate);
    if (!Number.isFinite(r) || r <= 0) {
      return NextResponse.json(
        { error: "Informe um valor de cotação válido (maior que zero)." },
        { status: 400 },
      );
    }
    // Arredonda pra 4 casas — evita ruído de ponto flutuante na exibição.
    manual_rate = Math.round(r * 10000) / 10000;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: SETTINGS_KEY, value: { mode, manual_rate } },
      { onConflict: "key" },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ config: { mode, manual_rate } });
}
