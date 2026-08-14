import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { updateMetaBid } from "@/lib/facebook-ads";

/**
 * Alteração do Limite de lance (bid_amount) de um conjunto (ou campanha que
 * tiver bid cap). Espelho da rota de orçamento.
 *
 * Body: { accountId, metaId, value }
 *   - accountId : UUID do ad_accounts dono (pra achar o access_token).
 *   - metaId    : adset_id (ou campaign_id) no Meta.
 *   - value     : novo lance NA MOEDA da conta, em unidade (ex: 2.50). A API
 *                 converte pra centavos, que é o que a Graph API espera.
 *
 * ESCRITA na Graph API — exige `ads_management` no token. Autenticado por sessão.
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json().catch(() => ({}));
  const accountId = body?.accountId ? String(body.accountId) : "";
  const metaId    = body?.metaId ? String(body.metaId) : "";
  const value     = Number(body?.value);

  if (!accountId || !metaId) {
    return NextResponse.json({ error: "Conta ou objeto ausente." }, { status: 400 });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
  }
  if (value > 1_000_000) {
    return NextResponse.json({ error: "Valor muito alto — confira o número." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: acct } = await supabase
    .from("ad_accounts")
    .select("access_token, is_active")
    .eq("id", accountId)
    .maybeSingle();
  const account = acct as { access_token: string; is_active: boolean } | null;
  if (!account || !account.access_token) {
    return NextResponse.json({ error: "Conta de anúncio não encontrada." }, { status: 404 });
  }

  const cents = Math.round(value * 100);

  const result = await updateMetaBid({
    accessToken: account.access_token,
    metaId,
    cents,
  });

  if (!result.ok) {
    console.error("[api/campaigns/bid] Meta rejeitou:", {
      code: result.code, subcode: result.subcode,
      error: result.error, userMsg: result.userMsg,
    });

    const metaMsg = result.userMsg || result.error || "Falha ao alterar o lance no Meta.";
    const looksPermission =
      result.code === 294 ||
      /ads_management|permission|permiss|extended permission|access/i.test(metaMsg);
    const hint = looksPermission
      ? " · Dica: confirme que o token da conta tem ads_management e que o usuário tem acesso de administrador a esta conta no Meta."
      : "";

    return NextResponse.json(
      { error: `Meta: ${metaMsg}${hint}`, code: result.code, subcode: result.subcode },
      { status: looksPermission ? 403 : 502 },
    );
  }

  // Mesma tag do fetchAccountObjects — pro valor novo aparecer no refresh.
  revalidateTag("meta-objects");

  return NextResponse.json({ success: true, value });
}
