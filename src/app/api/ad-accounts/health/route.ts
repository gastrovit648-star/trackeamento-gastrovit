import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/ad-accounts/health
 *
 * Testa o token de cada ad_account ativa fazendo um GET simples no Graph
 * (/act_{id}?fields=name,account_status). Retorna status por conta:
 *   - ok: token válido, conta acessível
 *   - error: token rejeitou ou conta inacessível (mostra mensagem do Meta)
 *
 * Use quando o dashboard mostrar spend zerado e você suspeitar que algum
 * token foi revogado. Conta com erro provavelmente perdeu acesso na BM.
 */
export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("ad_accounts")
    .select("id, bm_id, account_id, name, access_token")
    .eq("is_active", true);

  type Row = { id: string; bm_id: string; account_id: string; name: string; access_token: string };
  const rows = (accounts ?? []) as Row[];

  const results = await Promise.all(
    rows.map(async a => {
      const url = `https://graph.facebook.com/v19.0/act_${a.account_id}?fields=name,account_status&access_token=${a.access_token}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (data.error) {
          return {
            id: a.id,
            bm_id: a.bm_id,
            account_id: a.account_id,
            name: a.name,
            status: "error" as const,
            error_code: data.error.code ?? null,
            error_message: data.error.message ?? "Erro desconhecido",
          };
        }
        return {
          id: a.id,
          bm_id: a.bm_id,
          account_id: a.account_id,
          name: a.name,
          status: "ok" as const,
          meta_name: data.name ?? null,
          account_status: data.account_status ?? null,
        };
      } catch (err) {
        return {
          id: a.id,
          bm_id: a.bm_id,
          account_id: a.account_id,
          name: a.name,
          status: "error" as const,
          error_code: null,
          error_message: `Network: ${String(err)}`,
        };
      }
    }),
  );

  const ok = results.filter(r => r.status === "ok").length;
  const errors = results.filter(r => r.status === "error").length;

  return NextResponse.json({
    total: results.length,
    ok,
    errors,
    accounts: results,
  });
}
