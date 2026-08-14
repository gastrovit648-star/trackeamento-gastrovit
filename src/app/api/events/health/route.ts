import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/events/health
 *
 * Stats de saúde do envio CAPI nas últimas 24h. Usado pelo badge no header
 * pra alertar visualmente sobre token expirado, rate limit, etc.
 *
 * Retorna:
 *   - total, errors, error_rate
 *   - has_token_error: true se algum response.error.code == 190 detectado
 *   - top_error_code: código de erro mais comum (se houver)
 */
export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, count } = await supabase
    .from("events_log")
    .select("response_meta", { count: "exact" })
    .gte("created_at", since)
    .limit(2000);

  type Row = { response_meta: Record<string, unknown> | null };
  const rows = (data ?? []) as Row[];

  const total = count ?? rows.length;
  let errors = 0;
  let hasTokenError = false;
  const codeCount = new Map<number, number>();

  for (const r of rows) {
    const resp = r.response_meta;
    if (!resp || typeof resp !== "object") continue;
    const hasOK = "events_received" in resp && Number(resp.events_received) > 0;
    if (hasOK) continue;
    // Tudo que não foi success conta como erro
    if ("error" in resp || "retries_exhausted" in resp || "skipped" in resp) {
      errors++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errObj = (resp as any).error;
      const code = errObj?.code ? Number(errObj.code) : null;
      if (code === 190 || code === 102) hasTokenError = true; // 190=invalid token, 102=session invalid
      if (code !== null && !Number.isNaN(code)) {
        codeCount.set(code, (codeCount.get(code) ?? 0) + 1);
      }
    }
  }

  let topErrorCode: number | null = null;
  let topErrorCount = 0;
  codeCount.forEach((n, code) => {
    if (n > topErrorCount) { topErrorCount = n; topErrorCode = code; }
  });

  return NextResponse.json({
    window_hours: 24,
    total,
    errors,
    error_rate: total > 0 ? errors / total : 0,
    has_token_error: hasTokenError,
    top_error_code: topErrorCode,
    top_error_count: topErrorCount,
  });
}
