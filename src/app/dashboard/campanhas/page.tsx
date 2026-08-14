export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import {
  getDateRange,
  getCampaignHierarchy,
  getActiveAdAccounts,
  buildRevenueBreakdownLines,
} from "@/lib/queries";
import { resolveProjectScope } from "@/lib/projects";
import { formatCurrency } from "@/lib/utils";
import { MetricCard } from "@/components/metric-card";
import { HighlightCard } from "@/components/highlight-card";
import { CampaignTree } from "@/components/campaign-tree";
import { Barcode, DollarSign, QrCode, ShoppingCart, Target, TrendingUp, XCircle } from "lucide-react";

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; account?: string; creative?: string; creativeId?: string; project?: string };
}) {
  const { from, to, since, until } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const adDateRange = { since, until };
  const adAccountFilter = searchParams.account || null;
  const { projectId, projectAccountIds } = await resolveProjectScope(supabase, searchParams.project);

  const accounts = await getActiveAdAccounts(supabase, adAccountFilter, projectId);
  const result = await getCampaignHierarchy(
    supabase, from, to, adDateRange, accounts,
    { adAccountFilter, projectAccountIds },
  );

  // CPA médio calculado sobre spend + 12.5% imposto (custo real)
  const avgCpa = result.totalPurchases > 0
    ? result.totalSpendWithTax / result.totalPurchases : 0;

  // URL desta página SEM o filtro por criativo — o botão "ver tudo" da árvore
  // navega pra cá pra limpar o ?creative/?creativeId da barra (senão o filtro
  // volta num reload). Preserva só período/conta.
  const cleanParams = new URLSearchParams();
  if (searchParams.from) cleanParams.set("from", searchParams.from);
  if (searchParams.to) cleanParams.set("to", searchParams.to);
  if (searchParams.account) cleanParams.set("account", searchParams.account);
  if (searchParams.project) cleanParams.set("project", searchParams.project);
  const clearCreativeHref = cleanParams.toString()
    ? `/dashboard/campanhas?${cleanParams.toString()}`
    : "/dashboard/campanhas";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Investido (total)"
          value={formatCurrency(result.totalSpendWithTax)}
          icon={DollarSign}
          subtitle={
            result.totalSpend > 0 ? (
              <>
                <span className="block">investido: {formatCurrency(result.totalSpend)}</span>
                <span className="block">imposto: {formatCurrency(result.totalSpendWithTax - result.totalSpend)}</span>
              </>
            ) : undefined
          }
          delay={0}
        />
        <MetricCard
          title="Faturamento"
          value={formatCurrency(result.totalRevenue)}
          icon={ShoppingCart}
          subtitle={
            result.totalRevenue > 0
              ? (
                <>
                  {buildRevenueBreakdownLines(result.revenueByPlatformMethod).map(l => (
                    <span key={l.label} className="block">
                      {l.label}: {formatCurrency(l.value)}
                    </span>
                  ))}
                </>
              )
              : undefined
          }
          delay={1}
        />
        <HighlightCard
          title="Lucro"
          value={formatCurrency(result.totalLucro)}
          accent={result.totalLucro >= 0 ? "green" : "red"}
          icon={TrendingUp}
          subtitle={result.totalLucro >= 0 ? "faturamento − investido c/ imp." : "prejuízo"}
          delay={2}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Leads" value={result.totalLeads.toLocaleString("pt-BR")} icon={Target} delay={4} />
        <MetricCard title="Vendas" value={result.totalPurchases.toLocaleString("pt-BR")} icon={ShoppingCart} delay={5} />
        <MetricCard title="CPA Médio" value={avgCpa > 0 ? formatCurrency(avgCpa) : "—"} icon={Target} delay={6} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Boletos gerados"
          value={result.totalBoletosGerados.count.toLocaleString("pt-BR")}
          icon={Barcode}
          subtitle={
            result.totalBoletosGerados.count > 0
              ? `${formatCurrency(result.totalBoletosGerados.value)} em valor`
              : undefined
          }
          delay={7}
        />
        <MetricCard
          title="PIX gerados"
          value={result.totalPixGerados.count.toLocaleString("pt-BR")}
          icon={QrCode}
          subtitle={
            result.totalPixGerados.count > 0
              ? `${formatCurrency(result.totalPixGerados.value)} em valor`
              : undefined
          }
          delay={8}
        />
        <MetricCard
          title="Cartões recusados"
          value={result.totalCartoesRecusados.count.toLocaleString("pt-BR")}
          icon={XCircle}
          subtitle={
            result.totalCartoesRecusados.count > 0
              ? `${formatCurrency(result.totalCartoesRecusados.value)} não capturados`
              : undefined
          }
          delay={9}
        />
      </div>
      <CampaignTree
        campaigns={result.campaigns}
        initialCreative={searchParams.creative}
        initialCreativeId={searchParams.creativeId}
        clearCreativeHref={clearCreativeHref}
      />
      {accounts.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma conta de anúncio ativa cadastrada.
          {" "}<a href="/dashboard/configuracoes" className="underline">Cadastrar agora</a>
        </div>
      )}
    </div>
  );
}
