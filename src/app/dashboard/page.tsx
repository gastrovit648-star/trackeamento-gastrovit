export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import {
  getDateRange,
  getOverviewMetrics,
  getDailyTimeSeries,
  getActiveAdAccounts,
} from "@/lib/queries";
import { resolveProjectScope } from "@/lib/projects";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { MetricCard } from "@/components/metric-card";
import { HighlightCard } from "@/components/highlight-card";
import { EvolutionChart } from "@/components/evolution-chart";
import {
  AlertTriangle,
  Barcode,
  CalendarClock,
  DollarSign,
  MousePointerClick,
  QrCode,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        {children}
      </span>
      <span className="flex-1 h-px bg-border/60" />
    </div>
  );
}

// Bloco de resultado de UM tipo de venda: Faturamento + ROAS + Lucro, sobre o
// mesmo investido (spendWithTax é o denominador comum — o gasto é do anúncio,
// não separável por tipo). Usado pelo seletor Antecipado/Agendamento/Ambos.
function ResultBlock({
  label, revenue, count, spendWithTax, hint,
}: {
  label: string; revenue: number; count: number; spendWithTax: number; hint?: string;
}) {
  const roas = spendWithTax > 0 ? revenue / spendWithTax : 0;
  const lucro = revenue - spendWithTax;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-foreground/80">
        {label}
        <span className="ml-2 font-normal font-mono text-[11px] text-muted-foreground">
          {count.toLocaleString("pt-BR")} {hint ?? (count === 1 ? "venda" : "vendas")}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Faturamento" value={formatCurrency(revenue)} icon={ShoppingCart} delay={0} />
        <HighlightCard
          title="ROAS"
          value={roas > 0 ? `${roas.toFixed(2)}×` : "—"}
          accent="blue"
          icon={Target}
          subtitle={spendWithTax > 0 ? `${formatCurrency(revenue)} / ${formatCurrency(spendWithTax)}` : "sem investimento"}
          delay={0}
        />
        <HighlightCard
          title="Lucro"
          value={formatCurrency(lucro)}
          accent={lucro >= 0 ? "green" : "red"}
          icon={TrendingUp}
          subtitle={lucro >= 0 ? "faturamento − investido c/ imp." : "prejuízo no período"}
          delay={0}
        />
      </div>
    </div>
  );
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; account?: string; view?: string; project?: string };
}) {
  const { from, to, since, until } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const adDateRange = { since, until };
  const adAccountFilter = searchParams.account || null;
  const { projectId, projectAccountIds } = await resolveProjectScope(supabase, searchParams.project);
  // Modo de visualização de vendas: antecipado | agendamento | ambos (default).
  const view =
    searchParams.view === "antecipado" || searchParams.view === "agendamento"
      ? searchParams.view
      : "ambos";
  const mkViewHref = (v: string) => {
    const p = new URLSearchParams();
    if (searchParams.from) p.set("from", searchParams.from);
    if (searchParams.to) p.set("to", searchParams.to);
    if (searchParams.account) p.set("account", searchParams.account);
    if (searchParams.project) p.set("project", searchParams.project);
    p.set("view", v);
    return `?${p.toString()}`;
  };

  const accounts = await getActiveAdAccounts(supabase, adAccountFilter, projectId);
  const [metrics, dailySeries] = await Promise.all([
    getOverviewMetrics(supabase, from, to, adDateRange, accounts, { adAccountFilter, projectAccountIds }),
    getDailyTimeSeries(supabase, from, to, adDateRange, accounts, { adAccountFilter, projectAccountIds }),
  ]);

  // Banner de "leads órfãos": conta tem gasto no período mas zero leads
  // atribuídos. Sinal forte de leads recebidos com ad_account_id=NULL
  // (resolução do source_id falhou na época — geralmente token expirado).
  const showOrphanWarning =
    !!adAccountFilter && metrics.leads === 0 && metrics.spend > 0;

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto">
      {showOrphanWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-[hsl(var(--accent-amber)/0.4)] bg-[hsl(var(--accent-amber)/0.08)] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--accent-amber))] shrink-0 mt-0.5" strokeWidth={2} />
          <div className="flex-1 text-xs text-foreground">
            <p className="font-medium">Esta conta tem gasto no período mas zero leads atribuídos.</p>
            <p className="text-muted-foreground mt-0.5">
              Pode ser conta sem campanhas CTWA ativas, ou leads que chegaram com token de BM expirado. Contate o administrador.
            </p>
          </div>
        </div>
      )}

      {/* ── RESULTADO — por tipo de venda (seletor Antecipado/Agendamento/Ambos) ── */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Resultado</span>
          <div className="inline-flex h-7 items-center rounded-md border border-border overflow-hidden text-[11px]">
            {([["ambos", "Ambos"], ["antecipado", "Antecipado"], ["agendamento", "Agendamento"]] as const).map(([v, label]) => (
              <a
                key={v}
                href={mkViewHref(v)}
                className={`h-full px-2.5 flex items-center transition-colors ${
                  view === v
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                {label}
              </a>
            ))}
          </div>
          <span className="flex-1 h-px bg-border/60" />
        </div>

        {/* Investido — comum a todos os modos (o gasto é do anúncio, não separável por tipo) */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-5">
          <MetricCard
            title="Investido (total)"
            value={formatCurrency(metrics.spendWithTax)}
            icon={DollarSign}
            subtitle={
              metrics.spend > 0 ? (
                <>
                  <span className="block">investido: {formatCurrency(metrics.spend)}</span>
                  <span className="block">imposto: {formatCurrency(metrics.spendWithTax - metrics.spend)}</span>
                </>
              ) : undefined
            }
            delay={0}
          />
        </div>

        <div className="space-y-5">
          {(view === "antecipado" || view === "ambos") && (
            <ResultBlock
              label="Pagamento antecipado"
              revenue={metrics.antecipado.value}
              count={metrics.antecipado.count}
              spendWithTax={metrics.spendWithTax}
            />
          )}
          {(view === "agendamento" || view === "ambos") && (
            <ResultBlock
              label="Agendamento — comprometido (gerado)"
              revenue={metrics.agendamentos.value}
              count={metrics.agendamentos.count}
              spendWithTax={metrics.spendWithTax}
              hint={metrics.agendamentos.count === 1 ? "agendamento" : "agendamentos"}
            />
          )}
          {(view === "agendamento" || view === "ambos") && (
            <ResultBlock
              label="Agendamento — pago (realizado)"
              revenue={metrics.agendamentoPago.value}
              count={metrics.agendamentoPago.count}
              spendWithTax={metrics.spendWithTax}
              hint={`pago${metrics.agendamentoPago.count === 1 ? "" : "s"} de ${metrics.agendamentos.count.toLocaleString("pt-BR")}`}
            />
          )}
        </div>
      </section>

      {/* ── EVOLUÇÃO DIÁRIA ───────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Evolução no período</SectionLabel>
        <EvolutionChart data={dailySeries} />
      </section>

      {/* ── FUNIL — Leads, CPL, Vendas, CPA ───────────────────────────────── */}
      <section>
        <SectionLabel>Funil de conversão</SectionLabel>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Leads"
            value={metrics.leads.toLocaleString("pt-BR")}
            icon={Users}
            delay={4}
          />
          <MetricCard
            title="CPL"
            value={metrics.cpl > 0 ? formatCurrency(metrics.cpl) : "—"}
            icon={DollarSign}
            delay={5}
          />
          <MetricCard
            title="Vendas"
            value={metrics.purchases.toLocaleString("pt-BR")}
            icon={ShoppingCart}
            delay={6}
          />
          <MetricCard
            title="CPA"
            value={metrics.cpa > 0 ? formatCurrency(metrics.cpa) : "—"}
            icon={Target}
            delay={7}
          />
        </div>
      </section>

      {/* ── TRANSAÇÕES — Boletos/PIX gerados, cartões recusados ───────────── */}
      <section>
        <SectionLabel>Transações do gateway</SectionLabel>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard
            title="Boletos gerados"
            value={metrics.boletosGerados.count.toLocaleString("pt-BR")}
            icon={Barcode}
            subtitle={
              metrics.boletosGerados.count > 0
                ? `${formatCurrency(metrics.boletosGerados.value)} em valor`
                : undefined
            }
            delay={8}
          />
          <MetricCard
            title="PIX gerados"
            value={metrics.pixGerados.count.toLocaleString("pt-BR")}
            icon={QrCode}
            subtitle={
              metrics.pixGerados.count > 0
                ? `${formatCurrency(metrics.pixGerados.value)} em valor`
                : undefined
            }
            delay={9}
          />
          <MetricCard
            title="Cartões recusados"
            value={metrics.cartoesRecusados.count.toLocaleString("pt-BR")}
            icon={XCircle}
            subtitle={
              metrics.cartoesRecusados.count > 0
                ? `${formatCurrency(metrics.cartoesRecusados.value)} não capturados`
                : undefined
            }
            delay={10}
          />
        </div>
      </section>

      {/* ── AGENDAMENTOS — Pay After Delivery ──────────────────────────────── */}
      <section>
        <SectionLabel>Agendamentos (Pay After Delivery)</SectionLabel>
        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard
            title="Agendamentos"
            value={metrics.agendamentos.count.toLocaleString("pt-BR")}
            icon={CalendarClock}
            subtitle="pedidos a pagar na entrega"
            delay={11}
          />
          <MetricCard
            title="Faturamento agendado"
            value={formatCurrency(metrics.agendamentos.value)}
            icon={Wallet}
            subtitle="a receber quando pagar"
            delay={12}
          />
        </div>
      </section>

      {/* ── TRÁFEGO — Cliques, CPC, Match Rate ────────────────────────────── */}
      <section>
        <SectionLabel>Tráfego & qualidade</SectionLabel>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard
            title="Cliques"
            value={metrics.clicks.toLocaleString("pt-BR")}
            icon={MousePointerClick}
            delay={11}
          />
          <MetricCard
            title="CPC"
            value={metrics.cpc > 0 ? formatCurrency(metrics.cpc) : "—"}
            icon={DollarSign}
            delay={12}
          />
          <MetricCard
            title="Match Rate"
            value={formatPercent(metrics.matchRate)}
            icon={Target}
            delay={13}
          />
        </div>
      </section>
    </div>
  );
}
