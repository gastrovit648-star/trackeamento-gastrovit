import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { updateMetaStatus } from "@/lib/facebook-ads";

/**
 * Ativa/desativa uma campanha (status ACTIVE ↔ PAUSED) no Meta.
 *
 * Body: { accountId, metaId, status: "ACTIVE" | "PAUSED" }
 *   - accountId : UUID do ad_accounts dono (pra achar o access_token).
 *   - metaId    : campaign_id no Meta.
 *   - status    : novo status.
 *
 * ESCRITA na Graph API — exige `ads_management` no token E acesso de gerenciar
 * campanhas na conta (mesma condição da edição de orçamento). Autenticado por
 * sessão. Erro do Meta é repassado cru (com dica quando parece permissão).
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json().catch(() => ({}));
  const accountId = body?.accountId ? String(body.accountId) : "";
  const metaId    = body?.metaId ? String(body.metaId) : "";
  const status: "ACTIVE" | "PAUSED" = body?.status === "ACTIVE" ? "ACTIVE" : "PAUSED";

  if (!accountId || !metaId) {
    return NextResponse.json({ error: "Conta ou campanha ausente." }, { status: 400 });
  }
  if (body?.status !== "ACTIVE" && body?.status !== "PAUSED") {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: acct } = await supabase
    .from("ad_accounts")
    .select("access_token")
    .eq("id", accountId)
    .maybeSingle();
  const account = acct as { access_token: string } | null;
  if (!account || !account.access_token) {
    return NextResponse.json({ error: "Conta de anúncio não encontrada." }, { status: 404 });
  }

  const result = await updateMetaStatus({ accessToken: account.access_token, metaId, status });

  if (!result.ok) {
    console.error("[api/campaigns/status] Meta rejeitou:", {
      code: result.code, subcode: result.subcode, error: result.error, userMsg: result.userMsg,
    });
    const metaMsg = result.userMsg || result.error || "Falha ao alterar o status no Meta.";
    const looksPermission =
      result.code === 294 ||
      /ads_management|permission|permiss|extended permission|access/i.test(metaMsg);
    const hint = looksPermission
      ? " · Dica: o token precisa de ads_management e o usuário precisa ter acesso de administrador a esta conta no Meta."
      : "";
    return NextResponse.json(
      { error: `Meta: ${metaMsg}${hint}`, code: result.code },
      { status: looksPermission ? 403 : 502 },
    );
  }

  revalidateTag("meta-objects");
  return NextResponse.json({ success: true, status });
}
