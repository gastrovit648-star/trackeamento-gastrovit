import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { updateMetaBudget } from "@/lib/facebook-ads";

/**
 * Alteração de orçamento de campanha (CBO) ou conjunto (ABO) — Fase 2.
 *
 * Body: { accountId, metaId, budgetKind: "daily"|"lifetime", value }
 *   - accountId : UUID do ad_accounts dono (pra achar o access_token).
 *   - metaId    : campaign_id (CBO) ou adset_id (ABO) no Meta.
 *   - budgetKind: qual campo mexer — o MESMO tipo que a campanha já usa.
 *   - value     : novo valor NA MOEDA da conta, em unidade (ex: 50.00). A API
 *                 converte pra centavos, que é o que a Graph API espera.
 *
 * ESCRITA na Graph API — exige `ads_management` no token. Se o token só tiver
 * `ads_read`, o Meta devolve erro de permissão (código ~200/10/294) e a gente
 * traduz numa mensagem acionável. Autenticado por sessão (requireAuth).
 */
export async function POST(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json().catch(() => ({}));
  const accountId  = body?.accountId ? String(body.accountId) : "";
  const metaId     = body?.metaId ? String(body.metaId) : "";
  const budgetKind = body?.budgetKind === "lifetime" ? "lifetime" : "daily";
  const value      = Number(body?.value);

  if (!accountId || !metaId) {
    return NextResponse.json({ error: "Conta ou campanha ausente." }, { status: 400 });
  }
  // Sanidade: positivo, finito e abaixo de um teto absurdo (erro de digitação).
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: "Informe um valor maior que zero." },
      { status: 400 },
    );
  }
  if (value > 1_000_000) {
    return NextResponse.json(
      { error: "Valor muito alto — confira o número." },
      { status: 400 },
    );
  }

  // Token da conta dona (segredo — nunca sai do servidor).
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
  const field = budgetKind === "lifetime" ? "lifetime_budget" : "daily_budget";

  const result = await updateMetaBudget({
    accessToken: account.access_token,
    metaId,
    field,
    cents,
  });

  if (!result.ok) {
    // Loga o erro cru do Meta pro diagnóstico (aparece nos runtime logs Vercel).
    console.error("[api/campaigns/budget] Meta rejeitou:", {
      code: result.code, subcode: result.subcode,
      error: result.error, userMsg: result.userMsg,
    });

    // Mostra a mensagem REAL do Meta (prioriza a versão amigável error_user_msg).
    // Antes esta rota mascarava tudo como "falta ads_management", o que escondia
    // a causa real (ex: usuário sem acesso de admin à conta, orçamento com
    // agendamento, valor abaixo do mínimo do Meta). A mensagem crua é o que
    // permite diagnosticar.
    const metaMsg = result.userMsg || result.error || "Falha ao alterar o orçamento no Meta.";

    // 294 = especificamente ads_management. Códigos genéricos (200/10) ou texto
    // citando permissão ganham a dica de trocar o token, mas SEM esconder a msg.
    const looksPermission =
      result.code === 294 ||
      /ads_management|permission|permiss|extended permission|access/i.test(metaMsg);
    const hint = looksPermission
      ? " · Dica: confirme que você trocou o token da conta (chave em Configurações → Contas de anúncio) por um COM ads_management, e que esse usuário tem acesso de administrador a esta conta no Meta."
      : "";

    return NextResponse.json(
      { error: `Meta: ${metaMsg}${hint}`, code: result.code, subcode: result.subcode },
      { status: looksPermission ? 403 : 502 },
    );
  }

  // Invalida o cache de orçamento (fetchAccountObjects usa revalidate:60 +
  // tag "meta-objects") pra o valor novo aparecer no próximo refresh, sem
  // esperar os 60s de cache. ATENÇÃO: a tag TEM que casar com a de
  // fetchAccountObjects — quando era "meta-budgets" (nome antigo da função) o
  // valor voltava pro antigo após salvar, porque nada era invalidado.
  revalidateTag("meta-objects");

  return NextResponse.json({ success: true, value, budgetKind });
}
