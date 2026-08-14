export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import {
  getDateRange,
  getCampaignHierarchy,
  getActiveAdAccounts,
  rankCreatives,
} from "@/lib/queries";
import { resolveProjectScope } from "@/lib/projects";
import { CreativeRanking } from "@/components/creative-ranking";

export default async function CriativosPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; account?: string; project?: string };
}) {
  const { from, to, since, until } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const adDateRange = { since, until };
  const adAccountFilter = searchParams.account || null;
  const { projectId, projectAccountIds } = await resolveProjectScope(supabase, searchParams.project);

  const accounts = await getActiveAdAccounts(supabase, adAccountFilter, projectId);
  const result = await getCampaignHierarchy(
    supabase, from, to, adDateRange, accounts,
    // Só aqui vale puxar o creative{} do Meta (miniatura + link do criativo).
    { adAccountFilter, projectAccountIds, withCreatives: true },
  );
  const creatives = rankCreatives(result.campaigns);

  // Período/conta a preservar no link do criativo → árvore de Campanhas.
  const qp = new URLSearchParams();
  if (searchParams.from) qp.set("from", searchParams.from);
  if (searchParams.to) qp.set("to", searchParams.to);
  if (searchParams.account) qp.set("account", searchParams.account);
  if (searchParams.project) qp.set("project", searchParams.project);
  const baseQuery = qp.toString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Ranking de criativos</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          O mesmo criativo (anúncios de mesmo nome) somado numa linha. Ordene por
          vendas, ROAS, lucro e mais pra decidir o que escalar e o que matar.
        </p>
      </div>

      <CreativeRanking creatives={creatives} baseQuery={baseQuery} />

      {accounts.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma conta de anúncio ativa cadastrada.
          {" "}<a href="/dashboard/configuracoes" className="underline">Cadastrar agora</a>
        </div>
      )}
    </div>
  );
}
