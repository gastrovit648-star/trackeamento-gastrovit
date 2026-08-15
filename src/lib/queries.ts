import { SupabaseClient } from "@supabase/supabase-js";
import { startOfDay, endOfDay, format } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { TIMEZONE, creativeKey } from "./utils";
import {
  AdAccount,
  fetchCampaignInsights,
  fetchFullHierarchy,
  fetchAccountAds,
  fetchAccountObjects,
  type AdHierarchy,
  type AdHierarchyAdset,
  type BudgetCents,
} from "./facebook-ads";
import { fetchAllPaginated } from "./supabase-paginate";
import { getUsdToBrlRate, getUsdRatesForRange } from "./exchange-rate";

// ─────────────────────────────────────────────────────────────────────────────
// Conversão USD→BRL por dia. O spend de contas USD é convertido pela cotação
// DAQUELE dia (usd_brl_rates); dias sem cotação específica caem no fallback
// global (getUsdToBrlRate → manual fixo ou cotação ao vivo).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Taxa USD→BRL efetiva de uma conta no período: média das cotações diárias
 * ponderada pelo spend de cada dia. Aplicar essa taxa ao spend total da conta
 * dá o MESMO resultado que converter dia a dia e somar — útil pra converter a
 * árvore de campanhas (agregada por campanha, não por dia) de forma consistente
 * com o Overview. Se a conta não gastou no período, retorna o fallback.
 */
async function effectiveUsdRate(
  account: AdAccountRow,
  adDateRange: { since: string; until: string },
  rateMap: Map<string, number>,
  fallbackRate: number,
): Promise<number> {
  const daily = await fetchCampaignInsights(account, adDateRange, "campaign", "1");
  let num = 0;
  let den = 0;
  for (const r of daily) {
    const sp = parseFloat(r.spend || "0");
    if (sp <= 0) continue;
    const rate = (r.date_start && rateMap.get(r.date_start)) || fallbackRate;
    num += sp * rate;
    den += sp;
  }
  return den > 0 ? num / den : fallbackRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date range helper (mesmo padrão do pixelhub — período do filtro vira tanto
// timestamps ISO pra Postgres quanto YYYY-MM-DD pra time_range do Meta).
// ─────────────────────────────────────────────────────────────────────────────

export function getDateRange(searchParams: { from?: string; to?: string }): {
  from: string; to: string; since: string; until: string;
} {
  const now = toZonedTime(new Date(), TIMEZONE);
  // Default: hoje (mesmo dia, 00:00 → 23:59 no fuso SP).
  const defaultFrom = startOfDay(now);
  const defaultTo = endOfDay(now);

  let start = defaultFrom;
  let end = defaultTo;

  if (searchParams.from) start = startOfDay(new Date(searchParams.from + "T00:00:00"));
  if (searchParams.to)   end   = endOfDay(new Date(searchParams.to + "T00:00:00"));

  const fromUtc = fromZonedTime(start, TIMEZONE);
  const toUtc = fromZonedTime(end, TIMEZONE);

  return {
    from: fromUtc.toISOString(),
    to: toUtc.toISOString(),
    since: format(start, "yyyy-MM-dd"),
    until: format(end, "yyyy-MM-dd"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Data efetiva de venda (migration 016). Vendas aprovadas/reembolsadas contam
// no dia da APROVAÇÃO (purchases.approved_at), não no dia em que a transação
// foi criada — um boleto gerado dia X e pago dia Y é venda do dia Y, batendo
// com o Purchase do CAPI. Linhas legadas (approved_at NULL) caem no fallback
// created_at. Boletos/PIX GERADOS e cartões recusados continuam SEMPRE por
// created_at (o mesmo boleto conta como gerado em X e como venda em Y).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * String PostgREST pra `.or()`: linha entra se a data EFETIVA de aprovação
 * (approved_at, fallback created_at quando NULL) está no range. Usar nas
 * queries que só olham vendas aprovadas/reembolsadas (listagem de Vendas,
 * geo, afiliados).
 */
function effectiveDateOr(from: string, to: string): string {
  return (
    `and(approved_at.gte.${from},approved_at.lte.${to}),` +
    `and(approved_at.is.null,created_at.gte.${from},created_at.lte.${to})`
  );
}

/**
 * String PostgREST pra `.or()`: linha entra se QUALQUER uma das datas
 * (created_at OU approved_at) está no range. Usar nas queries que alimentam
 * métricas de aprovação E de geração de uma vez (Overview, árvore de
 * Campanhas) — o refino por métrica é feito em JS com makeInRange().
 */
function anyDateOr(from: string, to: string): string {
  return (
    `and(created_at.gte.${from},created_at.lte.${to}),` +
    `and(approved_at.gte.${from},approved_at.lte.${to})`
  );
}

/**
 * Predicado "timestamp ∈ [from, to]" comparando por epoch (não por string —
 * o range vem em UTC ISO e o timestamp do Postgres pode vir com offset).
 */
function makeInRange(
  from: string,
  to: string,
): (iso: string | null | undefined) => boolean {
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  return iso => {
    if (!iso) return false;
    const v = new Date(iso).getTime();
    return v >= f && v <= t;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad accounts: carrega contas ativas (ou uma específica).
// ─────────────────────────────────────────────────────────────────────────────

export interface AdAccountRow extends AdAccount {
  id: string;
  bm_id: string;
  name: string;
  currency: "BRL" | "USD";
}

export async function getActiveAdAccounts(
  supabase: SupabaseClient,
  filterId?: string | null,
  projectId?: string | null,
): Promise<AdAccountRow[]> {
  let q = supabase
    .from("ad_accounts")
    .select("id, bm_id, account_id, name, access_token, currency")
    .eq("is_active", true);
  // escopo por projeto (migration 021): conta pertence a >=1 projeto via array.
  if (projectId) q = q.contains("project_ids", [projectId]);
  if (filterId) q = q.eq("id", filterId);
  const { data, error } = await q;
  if (error) {
    console.error("[queries] getActiveAdAccounts:", error);
    return [];
  }
  return (data ?? []) as AdAccountRow[];
}

// Escopo de conta numa query de leads/purchases:
//  - adAccountFilter (conta única) tem precedência;
//  - senão, se um PROJETO está selecionado, filtra pelas contas do projeto
//    (projectAccountIds);
//  - sem nenhum → sem filtro (visão "todos os projetos", inclui não-atribuídos).
export interface AccountScope {
  adAccountFilter?: string | null;
  projectAccountIds?: string[] | null;
}
const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000"; // sentinela: nenhum match
function scopeAccount<Q>(q: Q, o: AccountScope): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = q as any;
  if (o.adAccountFilter) return query.eq("ad_account_id", o.adAccountFilter);
  // projectAccountIds != null → projeto selecionado (escopa mesmo se vazio:
  // projeto sem contas mostra ZERO, não tudo). null → visão "todos", sem filtro.
  if (o.projectAccountIds != null) {
    const ids = o.projectAccountIds.length > 0 ? o.projectAccountIds : [NO_ACCOUNT];
    return query.in("ad_account_id", ids);
  }
  return q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview metrics — todos os números agregados do header.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Imposto que a Meta cobra sobre o valor investido em anúncios (12.5%).
 * Aplicado nos cards principais (Overview + Campanhas top) pra refletir o
 * custo real. NÃO aplicado dentro da hierarquia de campanhas (CampaignTree),
 * onde mantemos o spend bruto que vem do Graph.
 *
 * IMPORTANTE — multimoeda: esse imposto é brasileiro e só incide sobre contas
 * faturadas em BRL. Contas em USD NÃO têm esse imposto adicional. Por isso a
 * agregação aplica a alíquota só sobre a parcela de spend das contas BRL
 * (`taxableSpend`), nunca sobre o total convertido. Ver getOverviewMetrics /
 * getCampaignHierarchy.
 */
export const META_TAX_RATE = 0.125;

export function withMetaTax(spend: number): number {
  return spend * (1 + META_TAX_RATE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Breakdown de faturamento por plataforma × método de pagamento e métricas de
// transações não-aprovadas (boleto/PIX gerado, cartão recusado). Alimentado
// pela coluna purchases.payment_method (migration 015, normalizada no webhook).
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformRevenueBreakdown {
  credit_card: number;
  boleto: number;
  pix: number;
  other: number;   // método desconhecido/ausente (vendas antigas, manuais)
  total: number;
}

export type RevenueByPlatformMethod = Record<
  "payt" | "luminar-pay" | "manual" | "skale" | "braip",
  PlatformRevenueBreakdown
>;

export interface TransactionStat {
  count: number;
  value: number;
}

type BreakdownRow = {
  source: "payt" | "manual" | "luminar-pay" | "skale" | "braip" | null;
  payment_method: string | null;
  value: number;
  commission_value: number | null;
};

function emptyBreakdown(): PlatformRevenueBreakdown {
  return { credit_card: 0, boleto: 0, pix: 0, other: 0, total: 0 };
}

/** Agrega vendas APROVADAS em plataforma × método. source null → Payt. */
function aggregateRevenueByPlatformMethod(rows: BreakdownRow[]): RevenueByPlatformMethod {
  const out: RevenueByPlatformMethod = {
    payt: emptyBreakdown(),
    "luminar-pay": emptyBreakdown(),
    manual: emptyBreakdown(),
    skale: emptyBreakdown(),
    braip: emptyBreakdown(),
  };
  for (const p of rows) {
    const platform =
      p.source === "manual" || p.source === "luminar-pay" || p.source === "skale" || p.source === "braip" ? p.source : "payt";
    const method =
      p.payment_method === "credit_card" || p.payment_method === "boleto" || p.payment_method === "pix"
        ? p.payment_method
        : "other";
    const v = Number(p.commission_value ?? p.value);
    out[platform][method] += v;
    out[platform].total += v;
  }
  return out;
}

export interface RevenueBreakdownLine {
  label: string;
  value: number;
}

/**
 * Linhas prontas pro subtitle do card Faturamento, no formato do design:
 *   Luminar cartão / Luminar boleto / Luminar PIX / Luminar total /
 *   Payt cartão / … / Payt total / Manual total.
 * Zeros são omitidos; Manual só mostra o total (não tem método).
 */
export function buildRevenueBreakdownLines(b: RevenueByPlatformMethod): RevenueBreakdownLine[] {
  const METHOD_LABELS = [
    ["credit_card", "cartão"],
    ["boleto", "boleto"],
    ["pix", "PIX"],
    ["other", "outros"],
  ] as const;
  const lines: RevenueBreakdownLine[] = [];
  ([["luminar-pay", "Luminar"], ["payt", "Payt"], ["skale", "Skale"], ["braip", "Braip"]] as const).forEach(([key, name]) => {
    const p = b[key];
    if (p.total <= 0) return;
    for (const [mKey, mLabel] of METHOD_LABELS) {
      if (p[mKey] > 0) lines.push({ label: `${name} ${mLabel}`, value: p[mKey] });
    }
    lines.push({ label: `${name} total`, value: p.total });
  });
  if (b.manual.total > 0) lines.push({ label: "Manual total", value: b.manual.total });
  return lines;
}

export interface OverviewMetrics {
  spend: number;
  spendWithTax: number;       // spend × 1.125 — usado em CPC, CPL, CPA, ROAS, Lucro
  clicks: number;
  cpc: number;
  leads: number;
  cpl: number;
  purchases: number;
  cpa: number;
  revenue: number;
  revenueByPlatformMethod: RevenueByPlatformMethod;
  roas: number;
  matchRate: number;
  refundedValue: number;
  // Transações do gateway ainda não aprovadas (payment_method via migration 015):
  boletosGerados: TransactionStat;    // qualquer status com método boleto
  pixGerados: TransactionStat;        // qualquer status com método pix
  cartoesRecusados: TransactionStat;  // status refused
  agendamentos: TransactionStat;      // Pay After Delivery — COMPROMETIDO (por scheduled_at)
  antecipado: TransactionStat;        // vendas pagas antecipadamente (approved, sem scheduled_at)
  agendamentoPago: TransactionStat;   // agendamentos JÁ pagos — realizado (subset do comprometido)
}

export async function getOverviewMetrics(
  supabase: SupabaseClient,
  from: string,
  to: string,
  adDateRange: { since: string; until: string },
  accounts: AdAccountRow[],
  options: AccountScope = {},
): Promise<OverviewMetrics> {
  type PurchaseRow = {
    value: number;
    commission_value: number | null;
    status: string;
    matched_lead: boolean;
    source: "payt" | "manual" | "luminar-pay" | "skale" | "braip" | null;
    payment_method: string | null;
    created_at: string;
    approved_at: string | null;
    scheduled_at: string | null;
  };

  // Soma spend/clicks de TODAS as contas ativas filtradas. Spend vem na moeda
  // de cada conta: contas USD têm o spend de CADA DIA convertido pra BRL pela
  // cotação daquele dia (usd_brl_rates; fallback global p/ dias sem cotação).
  // Por isso contas USD são buscadas com quebra diária (time_increment=1).
  // `spend` final está sempre em BRL.
  const [insightsByAccount, fallbackRate, rateMap] = await Promise.all([
    Promise.all(accounts.map(a =>
      fetchCampaignInsights(a, adDateRange, "campaign", a.currency === "USD" ? "1" : undefined),
    )),
    getUsdToBrlRate(),
    getUsdRatesForRange(adDateRange.since, adDateRange.until),
  ]);
  let spend = 0;          // total em BRL (já convertido)
  let taxableSpend = 0;   // só contas BRL — base do imposto Meta de 12,5%
  let clicks = 0;
  accounts.forEach((acc, idx) => {
    const rows = insightsByAccount[idx];
    if (acc.currency === "USD") {
      // Converte dia a dia: cada linha (campanha×dia) usa a cotação da sua data.
      for (const i of rows) {
        const daySpend = parseFloat(i.spend || "0");
        const rate = (i.date_start && rateMap.get(i.date_start)) || fallbackRate;
        spend  += daySpend * rate;   // converte, sem imposto
        clicks += parseInt(i.clicks || "0");
      }
    } else {
      for (const i of rows) {
        const accSpend = parseFloat(i.spend || "0");
        spend        += accSpend;
        taxableSpend += accSpend;    // BRL → entra na base do imposto
        clicks       += parseInt(i.clicks || "0");
      }
    }
  });

  let leadsQuery = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", from)
    .lte("created_at", to);
  leadsQuery = scopeAccount(leadsQuery, options);
  const { count: leadsCount } = await leadsQuery;
  const leads = leadsCount ?? 0;

  // Purchases agora tem ad_account_id próprio (migration 009 — snapshot da
  // atribuição via webhook). Filtra direto, sem precisar lookup via leads.
  // Range com anyDateOr: traz a linha se created_at OU approved_at cai no
  // período — as métricas de aprovação e de geração são refinadas em JS.
  let purchasesQuery = supabase
    .from("purchases")
    .select("value, commission_value, status, matched_lead, source, payment_method, created_at, approved_at, scheduled_at")
    .or(anyDateOr(from, to));
  purchasesQuery = scopeAccount(purchasesQuery, options);
  const purchaseRows = await fetchAllPaginated<PurchaseRow>(() => purchasesQuery);

  // Vendas aprovadas/reembolsadas contam pela data EFETIVA de aprovação
  // (approved_at, fallback created_at pro legado); boletos/PIX gerados e
  // recusados contam SEMPRE por created_at (subsets abaixo).
  const inRange = makeInRange(from, to);
  const createdInRange = purchaseRows.filter(p => inRange(p.created_at));
  const approved = purchaseRows.filter(
    p => p.status === "approved" && inRange(p.approved_at ?? p.created_at));
  const refunded = purchaseRows.filter(
    p => p.status === "refunded" && inRange(p.approved_at ?? p.created_at));
  const revenue = approved.reduce(
    (s, p) => s + Number(p.commission_value ?? p.value), 0);

  // Faturamento por plataforma × método (só aprovadas). source null → Payt
  // (gateway padrão, mesmo critério da listagem de Vendas).
  const revenueByPlatformMethod = aggregateRevenueByPlatformMethod(approved);
  const refundedValue = refunded.reduce(
    (s, p) => s + Number(p.commission_value ?? p.value), 0);
  const purchases = approved.length;

  // Transações do gateway: boletos/PIX gerados contam QUALQUER status com o
  // método (o gerado que depois paga continua contando como gerado); cartão
  // recusado é o status refused.
  const stat = (rows: PurchaseRow[]): TransactionStat => ({
    count: rows.length,
    value: rows.reduce((s, p) => s + Number(p.commission_value ?? p.value), 0),
  });
  const boletosGerados   = stat(createdInRange.filter(p => p.payment_method === "boleto"));
  const pixGerados       = stat(createdInRange.filter(p => p.payment_method === "pix"));
  const cartoesRecusados = stat(createdInRange.filter(p => p.status === "refused"));
  // Agendamentos (Pay After Delivery): contam por scheduled_at (persistente,
  // igual à coluna AGENDAMENTO da árvore). value = faturamento agendado.
  // Cancelado/estornado (refused/refunded) NÃO conta: quando um agendamento é
  // feito errado, cancelado e refeito, o cancelado vira refused/refunded mas o
  // scheduled_at persiste — sem esse filtro o cancelado + o refeito duplicavam.
  const isCancelled = (s: string) => s === "refused" || s === "refunded";
  const agendamentos     = stat(createdInRange.filter(p => p.scheduled_at != null && !isCancelled(p.status)));
  // Split pro seletor do Overview (antecipado vs PAD):
  //  - antecipado: venda paga na hora (approved SEM scheduled_at), por data efetiva.
  //  - agendamentoPago: agendamento JÁ pago (mesmo coorte do `agendamentos`, subset pago).
  const antecipado       = stat(approved.filter(p => p.scheduled_at == null));
  const agendamentoPago  = stat(createdInRange.filter(p => p.scheduled_at != null && p.status === "approved"));

  // CPC, CPL, CPA, ROAS — todos calculados sobre spend + 12.5% imposto Meta
  // pra refletir o custo real. Lucro é faturamento - spend_with_tax. O imposto
  // só incide sobre a parcela BRL (`taxableSpend`); contas USD entram em
  // `spend` já convertidas, sem imposto adicional.
  const spendWithTax = spend + taxableSpend * META_TAX_RATE;
  const cpc  = clicks    > 0 ? spendWithTax / clicks    : 0;
  const cpl  = leads     > 0 ? spendWithTax / leads     : 0;
  const cpa  = purchases > 0 ? spendWithTax / purchases : 0;
  const roas = spendWithTax > 0 ? revenue / spendWithTax : 0;

  const allSales = approved.length + refunded.length;
  const matchedSales =
    approved.filter(p => p.matched_lead).length +
    refunded.filter(p => p.matched_lead).length;
  const matchRate = allSales > 0 ? (matchedSales / allSales) * 100 : 0;

  return {
    spend, spendWithTax, clicks, cpc, leads, cpl, purchases, cpa,
    revenue, revenueByPlatformMethod, roas, matchRate, refundedValue,
    boletosGerados, pixGerados, cartoesRecusados, agendamentos,
    antecipado, agendamentoPago,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Série diária pro gráfico de evolução — faturamento, gasto, leads, vendas e
// ROAS por dia. Mesmas regras do Overview: gasto convertido USD→BRL pela cotação
// do dia; faturamento pela data EFETIVA de aprovação; leads por created_at.
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyPoint {
  date: string;      // YYYY-MM-DD (fuso SP)
  spend: number;     // BRL
  revenue: number;   // BRL — vendas aprovadas (data efetiva)
  leads: number;
  purchases: number;
  roas: number;
}

export async function getDailyTimeSeries(
  supabase: SupabaseClient,
  from: string,
  to: string,
  adDateRange: { since: string; until: string },
  accounts: AdAccountRow[],
  options: AccountScope = {},
): Promise<DailyPoint[]> {
  const dayInSP = (iso: string) => format(toZonedTime(new Date(iso), TIMEZONE), "yyyy-MM-dd");

  // ── Gasto por dia (TODAS as contas com time_increment=1) ───────────────────
  const [insightsByAccount, fallbackRate, rateMap] = await Promise.all([
    Promise.all(accounts.map(a => fetchCampaignInsights(a, adDateRange, "campaign", "1"))),
    getUsdToBrlRate(),
    getUsdRatesForRange(adDateRange.since, adDateRange.until),
  ]);
  const spendByDay = new Map<string, number>();
  accounts.forEach((acc, idx) => {
    for (const i of insightsByAccount[idx]) {
      const day = i.date_start;
      if (!day) continue;
      let s = parseFloat(i.spend || "0");
      if (acc.currency === "USD") s *= (day && rateMap.get(day)) || fallbackRate;
      spendByDay.set(day, (spendByDay.get(day) ?? 0) + s);
    }
  });

  // ── Faturamento + vendas por dia (aprovadas, data efetiva) ─────────────────
  type Row = { value: number; commission_value: number | null; status: string; created_at: string; approved_at: string | null };
  let pQuery = supabase
    .from("purchases")
    .select("value, commission_value, status, created_at, approved_at")
    .or(effectiveDateOr(from, to));
  pQuery = scopeAccount(pQuery, options);
  const purchaseRows = await fetchAllPaginated<Row>(() => pQuery);
  const inRange = makeInRange(from, to);
  const revenueByDay = new Map<string, number>();
  const purchasesByDay = new Map<string, number>();
  for (const p of purchaseRows) {
    if (p.status !== "approved") continue;
    const eff = p.approved_at ?? p.created_at;
    if (!inRange(eff)) continue;
    const day = dayInSP(eff);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + Number(p.commission_value ?? p.value));
    purchasesByDay.set(day, (purchasesByDay.get(day) ?? 0) + 1);
  }

  // ── Leads por dia (created_at) ─────────────────────────────────────────────
  let lQuery = supabase.from("leads").select("created_at").gte("created_at", from).lte("created_at", to);
  lQuery = scopeAccount(lQuery, options);
  const leadRows = await fetchAllPaginated<{ created_at: string }>(() => lQuery);
  const leadsByDay = new Map<string, number>();
  for (const l of leadRows) {
    const day = dayInSP(l.created_at);
    leadsByDay.set(day, (leadsByDay.get(day) ?? 0) + 1);
  }

  // ── Monta todos os dias do range (preenche zeros) ──────────────────────────
  const days: string[] = [];
  const cur = new Date(`${adDateRange.since}T12:00:00Z`);
  const last = new Date(`${adDateRange.until}T12:00:00Z`);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return days.map(date => {
    const spend = spendByDay.get(date) ?? 0;
    const revenue = revenueByDay.get(date) ?? 0;
    return {
      date, spend, revenue,
      leads: leadsByDay.get(date) ?? 0,
      purchases: purchasesByDay.get(date) ?? 0,
      roas: spend > 0 ? revenue / spend : 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaign hierarchy — cross-join Meta insights com leads e purchases.
// Match leads → ad/adset/campaign por ID (não UTM).
// Match purchases → atribuição persistida em purchases.{campaign_id,adset_id,ad_id}
// via snapshot do webhook (migration 009). Imutável e não depende de lookup
// em leads, então vendas cujo lead foi capturado fora do range continuam contadas.
// ─────────────────────────────────────────────────────────────────────────────

// Orçamento de uma campanha ou conjunto, pronto pra exibir. `value` já está na
// unidade da moeda (ex: 50.00), não em centavos. `kind` distingue teto diário
// de vitalício; `currency` é a moeda nativa da conta (não convertida, pra bater
// com o que o Meta mostra e com o que a edição da Fase 2 vai enviar de volta).
export interface BudgetView {
  value: number;
  kind: "daily" | "lifetime";
  currency: "BRL" | "USD";
  // UUID do ad_accounts dono — a edição (Fase 2) manda isso pra API achar o
  // access_token certo. Não é segredo (o token é); só identifica a conta.
  accountId: string;
}

// Limite de lance (bid_amount) do objeto. Só existe onde há estratégia de lance
// com limite (bid cap) — normalmente no conjunto. Valor já em unidade (÷100).
export interface BidView {
  value: number;
  currency: "BRL" | "USD";
  accountId: string;
}

export interface CampaignNode {
  id: string;
  name: string;
  spend: number;
  clicks: number;
  cpc: number;
  leads: number;
  cpl: number;
  purchases: number;
  cpa: number;
  revenue: number;
  roas: number;
  lucro: number;
  // Transações do gateway atribuídas ao nó (contagens; migration 015):
  boletos: number;      // boletos gerados (qualquer status)
  pixGerados: number;   // PIX gerados (qualquer status)
  recusados: number;    // cartões recusados (status refused)
  agendamentos: number; // pedidos Pay-After-Delivery (por scheduled_at, migration 018)
  agendamentosValue: number; // faturamento agendado (comprometido) — soma p/ totais
  cpaAgendamento: number; // gasto ÷ agendamentos (0 = sem agendamento)
  roasAgendamento: number; // faturamento agendado ÷ gasto (0 = sem gasto)
  // Nome da conta de anúncio dona da campanha (ad_accounts.name). É uma
  // propriedade do nível campaign: conjunto e anúncio herdam o valor do pai.
  // null quando a campanha é phantom e o ad_account_id do lead/venda não
  // resolve numa das contas do escopo (ex: conta desativada depois da venda).
  account_name?: string | null;
  // Orçamento configurado no Meta (não o gasto — é o teto planejado). Só existe
  // no nível onde foi definido: campanha (CBO) OU conjunto (ABO). null nos
  // demais níveis e em anúncios. Valor já em unidade da moeda (não centavos).
  budget?: BudgetView | null;
  // Limite de lance (bid_amount). Só onde há bid cap (normalmente conjunto);
  // null nos demais. Valor já em unidade (÷100).
  bid?: BidView | null;
  // Status configurado no Meta (ACTIVE/PAUSED/…) e o UUID da conta dona, usados
  // pelo toggle de ativar/desativar. Preenchidos no nível campanha (o pedido é
  // por campanha); conjuntos/anúncios não recebem por ora.
  status?: string | null;
  accountId?: string | null;
  // Só preenchido no nível Ad — extraído do source_url do primeiro lead
  // que matchou esse ad_id. Permite linkar pro criativo direto da arvore.
  source_url?: string | null;
  // Identidade REAL do criativo (Meta creative_id) + miniatura + link pra ver o
  // criativo no Meta. Só no nível Ad. Usados pelo Ranking de criativos pra
  // agrupar por criativo de verdade (o nome do anúncio colide entre criativos
  // diferentes) e abrir o criativo certo.
  creative_id?: string | null;
  thumbnail_url?: string | null;
  creative_link?: string | null;
}

export interface CampaignWithChildren extends CampaignNode {
  adsets: (CampaignNode & { ads: CampaignNode[] })[];
}

// ── Ranking de criativos ─────────────────────────────────────────────────────
// Uma linha do ranking = um CRIATIVO, definido pelo nome do anúncio. O mesmo
// criativo rodando em vários conjuntos/campanhas (anúncios distintos no Meta,
// mas de mesmo nome) é somado numa linha só. Razões (CPL/CPA/ROAS) recalculadas
// do agregado, não média das médias.
export interface CreativeRow {
  key: string;             // nome normalizado (chave de agrupamento)
  name: string;            // nome exibido (primeiro visto, sem normalizar)
  spend: number;
  leads: number;
  purchases: number;
  revenue: number;
  lucro: number;
  boletos: number;
  pixGerados: number;
  recusados: number;
  cpl: number;
  cpa: number;
  roas: number;
  adCount: number;         // quantos anúncios (instâncias) foram somados
  campaignCount: number;   // em quantas campanhas o criativo aparece
  activeCount: number;     // quantos dos anúncios estão ativos no Meta
  accountNames: string[];  // contas de anúncio onde o criativo roda
  creativeId: string | null;   // sempre null (agrupado por nome; a linha pode reunir vários creative_ids)
  thumbnailUrl: string | null; // miniatura do criativo (thumbnail_url do Meta, 1ª duplicata)
  creativeLink: string | null; // link pra ver o criativo no Meta (1ª duplicata)
}

/**
 * Achata todos os anúncios da hierarquia num ranking por criativo (nome).
 *
 * Reutiliza o resultado de getCampaignHierarchy (mesmos números da árvore de
 * Campanhas — spend já convertido pra BRL, sem imposto no nível do nó, igual à
 * árvore). Só entram criativos que realmente rodaram (gasto, lead OU venda) —
 * anúncios estruturais/phantom sem nenhum resultado ficam de fora do ranking.
 *
 * Agrupa pelo NOME do anúncio normalizado (trim + lowercase + espaços
 * colapsados). O nome é a identidade do criativo no fluxo do cliente (convenção
 * disciplinada: PST-AD90, REV-AD36…). NÃO agrupa por creative_id: o Meta gera um
 * creative_id DIFERENTE pra cada duplicata do MESMO criativo (entre contas e
 * campanhas), então agrupar por id separaria duplicatas que são o mesmo criativo
 * — o oposto do que o usuário quer (ver o criativo unificado, somando as contas).
 * A miniatura e o link "ver criativo" vêm do creative{} da 1ª duplicata (mesmo
 * visual em todas). Ordenação default por vendas desc; o componente re-ordena.
 */
export function rankCreatives(campaigns: CampaignWithChildren[]): CreativeRow[] {
  type Acc = {
    name: string; spend: number; leads: number; purchases: number; revenue: number;
    lucro: number; boletos: number; pixGerados: number; recusados: number;
    adCount: number; activeCount: number; campaigns: Set<string>;
    accounts: Set<string>; creativeId: string | null;
    thumbnailUrl: string | null; creativeLink: string | null;
  };
  const map = new Map<string, Acc>();

  for (const c of campaigns) {
    for (const a of c.adsets) {
      for (const ad of a.ads) {
        // Fora do ranking: anúncio sem gasto, sem lead e sem venda (estrutural).
        if (ad.spend <= 0 && ad.purchases <= 0 && ad.leads <= 0) continue;
        // Identidade = NOME normalizado (une duplicatas do mesmo criativo, que
        // no Meta têm creative_id distinto). creativeId da linha fica null: uma
        // linha (por nome) pode reunir vários creative_ids → deep-link por nome.
        const key = creativeKey(ad.name);
        let g = map.get(key);
        if (!g) {
          g = {
            name: ad.name.trim(), spend: 0, leads: 0, purchases: 0, revenue: 0,
            lucro: 0, boletos: 0, pixGerados: 0, recusados: 0, adCount: 0,
            activeCount: 0, campaigns: new Set(), accounts: new Set(),
            creativeId: null, thumbnailUrl: null, creativeLink: null,
          };
          map.set(key, g);
        }
        g.spend += ad.spend; g.leads += ad.leads; g.purchases += ad.purchases;
        g.revenue += ad.revenue; g.lucro += ad.lucro; g.boletos += ad.boletos;
        g.pixGerados += ad.pixGerados; g.recusados += ad.recusados;
        g.adCount += 1;
        if (ad.status === "ACTIVE") g.activeCount += 1;
        g.campaigns.add(c.id);
        if (ad.account_name) g.accounts.add(ad.account_name);
        if (!g.thumbnailUrl && ad.thumbnail_url) g.thumbnailUrl = ad.thumbnail_url;
        if (!g.creativeLink && ad.creative_link) g.creativeLink = ad.creative_link;
      }
    }
  }

  const rows: CreativeRow[] = [];
  map.forEach((g, key) => {
    rows.push({
      key, name: g.name,
      spend: g.spend, leads: g.leads, purchases: g.purchases, revenue: g.revenue,
      lucro: g.lucro, boletos: g.boletos, pixGerados: g.pixGerados, recusados: g.recusados,
      cpl: g.leads > 0 ? g.spend / g.leads : 0,
      cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
      roas: g.spend > 0 ? g.revenue / g.spend : 0,
      adCount: g.adCount, campaignCount: g.campaigns.size, activeCount: g.activeCount,
      accountNames: Array.from(g.accounts),
      creativeId: g.creativeId, thumbnailUrl: g.thumbnailUrl, creativeLink: g.creativeLink,
    });
  });
  rows.sort((x, y) => y.purchases - x.purchases);
  return rows;
}

export interface CampaignHierarchyResult {
  campaigns: CampaignWithChildren[];
  totalSpend: number;
  totalSpendWithTax: number;   // totalSpend × 1.125 — usado nos cards do topo
  totalRevenue: number;
  revenueByPlatformMethod: RevenueByPlatformMethod;
  totalLeads: number;
  totalPurchases: number;
  totalLucro: number;
  totalBoletosGerados: TransactionStat;
  totalPixGerados: TransactionStat;
  totalCartoesRecusados: TransactionStat;
}

export async function getCampaignHierarchy(
  supabase: SupabaseClient,
  from: string,
  to: string,
  adDateRange: { since: string; until: string },
  accounts: AdAccountRow[],
  options: AccountScope & { withCreatives?: boolean } = {},
): Promise<CampaignHierarchyResult> {
  type LeadRow = {
    phone: string;
    ad_account_id: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    ad_id: string | null;
    ad_name: string | null;
    source_url: string | null;
  };
  type PurchaseRow = {
    ad_account_id: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    ad_id: string | null;
    ad_name: string | null;
    value: number;
    commission_value: number | null;
    source: "payt" | "manual" | "luminar-pay" | "skale" | "braip" | null;
    status: string;
    payment_method: string | null;
    created_at: string;
    approved_at: string | null;
    scheduled_at: string | null;
  };

  let leadsQuery = supabase
    .from("leads")
    .select("phone, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, source_url:raw_webhook->>source_url")
    .gte("created_at", from)
    .lte("created_at", to);
  leadsQuery = scopeAccount(leadsQuery, options);
  const leads = await fetchAllPaginated<LeadRow>(() => leadsQuery);

  // Map ad_id → source_url do primeiro lead que tiver. Usado pra mostrar
  // link clicável do criativo no nível Ad da árvore de campanhas.
  const sourceUrlByAd = new Map<string, string>();
  for (const l of leads) {
    if (l.ad_id && l.source_url && !sourceUrlByAd.has(l.ad_id)) {
      sourceUrlByAd.set(l.ad_id, l.source_url);
    }
  }

  // Purchases do range — agrega direto pelas colunas de atribuição persistidas
  // em purchases (snapshot setado pelo webhook no momento do match). NÃO faz
  // JOIN com leads: histórico fica imutável mesmo se o lead for atualizado, e
  // vendas cujo lead foi capturado FORA do range continuam sendo contadas
  // (migration 009 corrigiu o bug de time-windowing assimétrico).
  // Busca TODAS as transações do range (não só aprovadas): pending/refused
  // alimentam as colunas Boletos/PIX/Recusados da árvore. Range com anyDateOr
  // (created_at OU approved_at no período) e refino em JS: vendas aprovadas
  // contam pela data EFETIVA de aprovação (approved_at, fallback created_at
  // pro legado — migration 016); boletos/PIX gerados e recusados contam
  // SEMPRE por created_at.
  let purchasesQuery = supabase
    .from("purchases")
    .select("ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, value, commission_value, source, status, payment_method, created_at, approved_at, scheduled_at")
    .or(anyDateOr(from, to));
  purchasesQuery = scopeAccount(purchasesQuery, options);
  const allPurchases = await fetchAllPaginated<PurchaseRow>(() => purchasesQuery);
  const inRange = makeInRange(from, to);
  const createdInRange = allPurchases.filter(p => inRange(p.created_at));
  const purchases = allPurchases.filter(
    p => p.status === "approved" && inRange(p.approved_at ?? p.created_at));

  // Stats por nível
  const leadsByCamp  = new Map<string, number>();
  const leadsByAdset = new Map<string, number>();
  const leadsByAd    = new Map<string, number>();
  for (const l of leads) {
    if (l.campaign_id) leadsByCamp.set(l.campaign_id,  (leadsByCamp.get(l.campaign_id)  ?? 0) + 1);
    if (l.adset_id)    leadsByAdset.set(l.adset_id,    (leadsByAdset.get(l.adset_id)    ?? 0) + 1);
    if (l.ad_id)       leadsByAd.set(l.ad_id,          (leadsByAd.get(l.ad_id)          ?? 0) + 1);
  }

  type Agg = { count: number; revenue: number };
  const buyByCamp  = new Map<string, Agg>();
  const buyByAdset = new Map<string, Agg>();
  const buyByAd    = new Map<string, Agg>();
  const bumpAgg = (m: Map<string, Agg>, k: string, v: number) => {
    const cur = m.get(k) ?? { count: 0, revenue: 0 };
    m.set(k, { count: cur.count + 1, revenue: cur.revenue + v });
  };
  for (const p of purchases) {
    const v = Number(p.commission_value ?? p.value);
    if (p.campaign_id) bumpAgg(buyByCamp,  p.campaign_id,  v);
    if (p.adset_id)    bumpAgg(buyByAdset, p.adset_id,     v);
    if (p.ad_id)       bumpAgg(buyByAd,    p.ad_id,        v);
  }

  // Transações do gateway por nó — mesma definição do Overview: boletos/PIX
  // gerados contam qualquer status com o método; recusados é o status refused.
  // Sempre por created_at (dia da geração/recusa), nunca por approved_at.
  // agendamentos = pedidos Pay-After-Delivery. Contam por scheduled_at (carimbo
  // persistente da migration 018): um pedido agendado no período conta aqui
  // mesmo que seja pago DEPOIS e vire 'approved' — o scheduled_at não some.
  // agendamentosValue = faturamento agendado (comprometido) do nó, pro ROAS de
  // agendamento (= agendamentosValue ÷ gasto). Os outros campos são contagens.
  type Extra = { boletos: number; pixGerados: number; recusados: number; agendamentos: number; agendamentosValue: number };
  const extraByCamp  = new Map<string, Extra>();
  const extraByAdset = new Map<string, Extra>();
  const extraByAd    = new Map<string, Extra>();
  const bumpExtra = (m: Map<string, Extra>, k: string, field: keyof Extra, amount = 1) => {
    const cur = m.get(k) ?? { boletos: 0, pixGerados: 0, recusados: 0, agendamentos: 0, agendamentosValue: 0 };
    cur[field] += amount;
    m.set(k, cur);
  };
  for (const p of createdInRange) {
    const fields: Array<keyof Extra> = [];
    if (p.payment_method === "boleto") fields.push("boletos");
    if (p.payment_method === "pix")    fields.push("pixGerados");
    if (p.status === "refused")        fields.push("recusados");
    // Agendamento cancelado/estornado não conta (cancela-e-refaz duplicava —
    // scheduled_at persiste mesmo virando refused/refunded).
    const isAgend = !!p.scheduled_at && p.status !== "refused" && p.status !== "refunded";
    if (isAgend) fields.push("agendamentos");
    for (const f of fields) {
      if (p.campaign_id) bumpExtra(extraByCamp,  p.campaign_id, f);
      if (p.adset_id)    bumpExtra(extraByAdset, p.adset_id,    f);
      if (p.ad_id)       bumpExtra(extraByAd,    p.ad_id,       f);
    }
    // Faturamento agendado por nó (pro ROAS de agendamento).
    if (isAgend) {
      const v = Number(p.commission_value ?? p.value);
      if (p.campaign_id) bumpExtra(extraByCamp,  p.campaign_id, "agendamentosValue", v);
      if (p.adset_id)    bumpExtra(extraByAdset, p.adset_id,    "agendamentosValue", v);
      if (p.ad_id)       bumpExtra(extraByAd,    p.ad_id,       "agendamentosValue", v);
    }
  }

  // Hierarquia do Meta — soma todas as contas no escopo. Spend vem na moeda de
  // cada conta: contas USD têm TODOS os nós (campaign/adset/ad) convertidos pra
  // BRL pela cotação ao vivo antes do flat, pra que a árvore e os totais fiquem
  // numa moeda única. `taxableSpend` acumula só o spend de contas BRL (base do
  // imposto Meta de 12,5% — contas USD não têm esse imposto).
  const [hierByAccount, fallbackRate, rateMap, structuralAdsByAccount, objectsByAccount] = await Promise.all([
    Promise.all(accounts.map(a => fetchFullHierarchy(a, adDateRange))),
    getUsdToBrlRate(),
    getUsdRatesForRange(adDateRange.since, adDateRange.until),
    // Anúncios estruturais (lista real do gerenciador) pra mostrar também os
    // anúncios sem gasto no período. Injetados com spend=0 mais abaixo. O fetch
    // de creative (miniatura/link) só liga em Criativos — na árvore de Campanhas
    // sai fora pra não pesar (é o gargalo em contas grandes).
    Promise.all(accounts.map(a => fetchAccountAds(a, { withCreatives: options.withCreatives }))),
    // Orçamento + status configurados (campanha CBO / conjunto ABO). Leitura pura.
    Promise.all(accounts.map(a => fetchAccountObjects(a))),
  ]);
  // Cada conta USD usa a taxa efetiva do período (média das cotações diárias
  // ponderada pelo spend de cada dia) — mantém a árvore consistente com o
  // Overview, que converte dia a dia.
  const usdRateByAccount = await Promise.all(
    accounts.map(a =>
      a.currency === "USD"
        ? effectiveUsdRate(a, adDateRange, rateMap, fallbackRate)
        : Promise.resolve(1),
    ),
  );
  // campaign_id → nome da conta dona. Precisa ser montado ANTES do .flat()
  // abaixo, que é onde a associação campanha↔conta se perde. Conjuntos e
  // anúncios herdam o valor da campanha pai na montagem final.
  const accountNameByCamp = new Map<string, string>();
  // Orçamento por campanha/conjunto — na moeda NATIVA da conta (não convertido:
  // é o valor que o Meta mostra e que a edição vai reenviar). Diário tem
  // precedência sobre vitalício quando ambos existem (raro).
  const budgetByCamp = new Map<string, BudgetView>();
  const budgetByAdset = new Map<string, BudgetView>();
  const bidByCamp = new Map<string, BidView>();
  const bidByAdset = new Map<string, BidView>();
  // Status configurado e conta dona (UUID) por nível — pro toggle ativar/pausar.
  const statusByCamp = new Map<string, string>();
  const accountIdByCamp = new Map<string, string>();
  const statusByAdset = new Map<string, string>();
  const accountIdByAdset = new Map<string, string>();
  const statusByAd = new Map<string, string>();
  const accountIdByAd = new Map<string, string>();
  // Identidade do criativo por anúncio (vem de fetchAccountAds → creative{…}).
  const creativeIdByAd = new Map<string, string>();
  const thumbnailByAd = new Map<string, string>();
  const creativeLinkByAd = new Map<string, string>();
  const toBudgetView = (b: BudgetCents, acc: AdAccountRow): BudgetView | null => {
    const base = { currency: acc.currency, accountId: acc.id };
    if (b.daily && b.daily > 0)       return { value: b.daily / 100,    kind: "daily",    ...base };
    if (b.lifetime && b.lifetime > 0) return { value: b.lifetime / 100, kind: "lifetime", ...base };
    return null;
  };
  let taxableSpend = 0;
  accounts.forEach((acc, idx) => {
    const camps = hierByAccount[idx];
    for (const c of camps) accountNameByCamp.set(c.id, acc.name);
    // .forEach() em Map porque o target ES5 do projeto não itera Map com for..of.
    objectsByAccount[idx].campaigns.forEach((meta, id) => {
      if (meta.budget) { const v = toBudgetView(meta.budget, acc); if (v) budgetByCamp.set(id, v); }
      if (meta.bid) bidByCamp.set(id, { value: meta.bid / 100, currency: acc.currency, accountId: acc.id });
      if (meta.status) statusByCamp.set(id, meta.status);
      accountIdByCamp.set(id, acc.id);
    });
    objectsByAccount[idx].adsets.forEach((meta, id) => {
      if (meta.budget) { const v = toBudgetView(meta.budget, acc); if (v) budgetByAdset.set(id, v); }
      if (meta.bid) bidByAdset.set(id, { value: meta.bid / 100, currency: acc.currency, accountId: acc.id });
      if (meta.status) statusByAdset.set(id, meta.status);
      accountIdByAdset.set(id, acc.id);
    });
    // Status próprio dos anúncios vem da lista estrutural (fetchAccountAds).
    for (const sa of structuralAdsByAccount[idx]) {
      if (sa.ownStatus) statusByAd.set(sa.id, sa.ownStatus);
      accountIdByAd.set(sa.id, acc.id);
      if (sa.creativeId) creativeIdByAd.set(sa.id, sa.creativeId);
      if (sa.thumbnailUrl) thumbnailByAd.set(sa.id, sa.thumbnailUrl);
      if (sa.creativeLink) creativeLinkByAd.set(sa.id, sa.creativeLink);
    }
    if (acc.currency === "USD") {
      const usdRate = usdRateByAccount[idx];
      for (const c of camps) {
        c.spend *= usdRate;
        for (const as_ of c.adsets) {
          as_.spend *= usdRate;
          for (const ad of as_.ads) ad.spend *= usdRate;
        }
      }
    } else {
      // Soma só o nível campaign (= total da conta) pra base do imposto.
      for (const c of camps) taxableSpend += c.spend;
    }
  });
  const allCampaigns = hierByAccount.flat();

  // ── Phantoms ─────────────────────────────────────────────────────────────
  // Meta /insights só devolve entidades com spend > 0 no período. Campanhas
  // pausadas/arquivadas com leads ou vendas no range sumiam da árvore. Aqui
  // injeta nós com spend=0 a partir do snapshot persistido em leads/purchases
  // pra que essas entidades apareçam (com métricas reais de leads/vendas e
  // ROAS infinito, mas pelo menos visíveis).
  const metaCampIds  = new Set(allCampaigns.map(c => c.id));
  const metaAdsetIds = new Set(allCampaigns.flatMap(c => c.adsets.map(a => a.id)));
  const metaAdIds    = new Set(allCampaigns.flatMap(c => c.adsets.flatMap(a => a.ads.map(d => d.id))));

  const phantomCamps  = new Map<string, { name: string }>();
  const phantomAdsets = new Map<string, { name: string; campaign_id: string }>();
  const phantomAds    = new Map<string, { name: string; adset_id: string }>();

  // Campanha phantom não veio do Graph, então não passou pelo loop que monta
  // accountNameByCamp. Recupera a conta pelo snapshot ad_account_id gravado no
  // lead/venda. Fica null se apontar pra conta fora do escopo (desativada ou
  // excluída pelo filtro de conta) — a coluna mostra "—" nesse caso.
  const accountNameById = new Map<string, string>();
  for (const a of accounts) accountNameById.set(a.id, a.name);

  type AttribLike = {
    ad_account_id: string | null;
    campaign_id: string | null; campaign_name: string | null;
    adset_id: string | null;    adset_name: string | null;
    ad_id: string | null;       ad_name: string | null;
  };
  const seedPhantoms = (rows: AttribLike[]) => {
    for (const r of rows) {
      if (r.campaign_id && !metaCampIds.has(r.campaign_id) && !phantomCamps.has(r.campaign_id)) {
        phantomCamps.set(r.campaign_id, { name: r.campaign_name ?? `(sem nome) ${r.campaign_id}` });
      }
      if (r.campaign_id && r.ad_account_id && !accountNameByCamp.has(r.campaign_id)) {
        const nm = accountNameById.get(r.ad_account_id);
        if (nm) accountNameByCamp.set(r.campaign_id, nm);
      }
      if (r.adset_id && r.campaign_id && !metaAdsetIds.has(r.adset_id) && !phantomAdsets.has(r.adset_id)) {
        phantomAdsets.set(r.adset_id, { name: r.adset_name ?? `(sem nome)`, campaign_id: r.campaign_id });
      }
      if (r.ad_id && r.adset_id && !metaAdIds.has(r.ad_id) && !phantomAds.has(r.ad_id)) {
        phantomAds.set(r.ad_id, { name: r.ad_name ?? `(sem nome)`, adset_id: r.adset_id });
      }
    }
  };
  // Todas as transações (não só aprovadas): um boleto pendente de campanha
  // pausada também precisa aparecer na árvore.
  seedPhantoms(allPurchases);
  seedPhantoms(leads);

  // .forEach() em Maps porque o TS target do projeto é ES5 — iterar Map
  // direto com for...of exige --downlevelIteration (não habilitado aqui).
  phantomCamps.forEach(({ name }, campId) => {
    allCampaigns.push({ id: campId, name, spend: 0, clicks: 0, adsets: [] });
  });
  const campById = new Map<string, AdHierarchy>();
  allCampaigns.forEach(c => campById.set(c.id, c));
  phantomAdsets.forEach(({ name, campaign_id }, adsetId) => {
    const camp = campById.get(campaign_id);
    if (camp) camp.adsets.push({ id: adsetId, name, spend: 0, clicks: 0, ads: [] });
  });
  const adsetById = new Map<string, AdHierarchyAdset>();
  allCampaigns.forEach(c => c.adsets.forEach(a => adsetById.set(a.id, a)));
  phantomAds.forEach(({ name, adset_id }, adId) => {
    const adset = adsetById.get(adset_id);
    if (adset) adset.ads.push({ id: adId, name, spend: 0, clicks: 0 });
  });

  // ── Campanhas/conjuntos estruturais (TODAS, mesmo sem gasto) ────────────────
  // /insights só devolve quem gastou; phantom cobre quem teve lead/venda. Aqui
  // injeta como spend=0 as campanhas/conjuntos da lista REAL do gerenciador
  // (fetchAccountObjects) que ainda não estão na árvore — pro cliente ver TODAS
  // as campanhas. Só ACTIVE/PAUSED: arquivada sem gasto não interessa (e a que
  // teve gasto já veio do /insights). O filtro "Ativas" do componente refina.
  accounts.forEach((acc, idx) => {
    objectsByAccount[idx].campaigns.forEach((meta, id) => {
      if (meta.status !== "ACTIVE" && meta.status !== "PAUSED") return;
      if (campById.has(id)) return;
      const c: AdHierarchy = { id, name: meta.name ?? `(sem nome) ${id}`, spend: 0, clicks: 0, adsets: [] };
      allCampaigns.push(c);
      campById.set(id, c);
      if (!accountNameByCamp.has(id)) accountNameByCamp.set(id, acc.name);
    });
  });
  accounts.forEach((_acc, idx) => {
    objectsByAccount[idx].adsets.forEach((meta, id) => {
      if (meta.status !== "ACTIVE" && meta.status !== "PAUSED") return;
      if (adsetById.has(id)) return;
      const camp = meta.campaignId ? campById.get(meta.campaignId) : undefined;
      if (!camp) return;
      const a: AdHierarchyAdset = { id, name: meta.name ?? "(sem nome)", spend: 0, clicks: 0, ads: [] };
      camp.adsets.push(a);
      adsetById.set(id, a);
    });
  });

  // ── Anúncios estruturais sem gasto ─────────────────────────────────────────
  // Injeta os anúncios da lista real do gerenciador (fetchAccountAds) que ainda
  // não estão na árvore, mas só pra conjuntos JÁ visíveis (que tiveram gasto ou
  // lead/venda). Assim o nível Ad mostra todos os anúncios do conjunto, mesmo
  // os que não gastaram, sem trazer conjuntos inteiros que não apareceriam.
  for (const sa of structuralAdsByAccount.flat()) {
    const adset = adsetById.get(sa.adset_id);
    if (!adset) continue;                                  // conjunto fora da árvore
    if (adset.ads.some(d => d.id === sa.id)) continue;     // já presente (com ou sem gasto)
    adset.ads.push({ id: sa.id, name: sa.name, spend: 0, clicks: 0 });
  }

  const node = (
    id: string, name: string, spend: number, clicks: number,
    leadCount: number, buys: Agg | undefined, extra: Extra | undefined,
  ): CampaignNode => {
    const purchases = buys?.count ?? 0;
    const revenue = buys?.revenue ?? 0;
    return {
      id, name, spend, clicks,
      cpc: clicks > 0 ? spend / clicks : 0,
      leads: leadCount,
      cpl: leadCount > 0 ? spend / leadCount : 0,
      purchases,
      cpa: purchases > 0 ? spend / purchases : 0,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      lucro: revenue - spend,
      boletos:      extra?.boletos      ?? 0,
      pixGerados:   extra?.pixGerados   ?? 0,
      recusados:    extra?.recusados    ?? 0,
      agendamentos: extra?.agendamentos ?? 0,
      agendamentosValue: extra?.agendamentosValue ?? 0,
      cpaAgendamento: (extra?.agendamentos ?? 0) > 0 ? spend / (extra!.agendamentos) : 0,
      roasAgendamento: spend > 0 ? (extra?.agendamentosValue ?? 0) / spend : 0,
    };
  };

  const campaigns: CampaignWithChildren[] = allCampaigns.map(c => {
    // Conta é propriedade da campanha — conjuntos e anúncios herdam.
    const account_name = accountNameByCamp.get(c.id) ?? null;
    const camp = node(
      c.id, c.name, c.spend, c.clicks,
      leadsByCamp.get(c.id) ?? 0,
      buyByCamp.get(c.id),
      extraByCamp.get(c.id),
    );
    const adsets = c.adsets.map(as_ => {
      const adsetNode = node(
        as_.id, as_.name, as_.spend, as_.clicks,
        leadsByAdset.get(as_.id) ?? 0,
        buyByAdset.get(as_.id),
        extraByAdset.get(as_.id),
      );
      const ads = as_.ads
        .map(ad => ({
          ...node(ad.id, ad.name, ad.spend, ad.clicks,
            leadsByAd.get(ad.id) ?? 0,
            buyByAd.get(ad.id),
            extraByAd.get(ad.id),
          ),
          source_url: sourceUrlByAd.get(ad.id) ?? null,
          creative_id: creativeIdByAd.get(ad.id) ?? null,
          thumbnail_url: thumbnailByAd.get(ad.id) ?? null,
          creative_link: creativeLinkByAd.get(ad.id) ?? null,
          account_name,
          budget: null,   // anúncio nunca tem orçamento próprio
          bid: null,      // anúncio nunca tem bid próprio
          status: statusByAd.get(ad.id) ?? null,
          accountId: accountIdByAd.get(ad.id) ?? null,
        }))
        // Maior gasto primeiro; anúncios sem gasto (estruturais/phantom) no fim.
        .sort((a, b) => b.spend - a.spend);
      // Orçamento no nível onde o Meta o define: campanha (CBO) ou conjunto
      // (ABO). Mostra onde existir; o outro nível fica sem (null → "—").
      return {
        ...adsetNode, account_name,
        budget: budgetByAdset.get(as_.id) ?? null,
        bid: bidByAdset.get(as_.id) ?? null,
        status: statusByAdset.get(as_.id) ?? null,
        accountId: accountIdByAdset.get(as_.id) ?? null,
        ads,
      };
    });
    return {
      ...camp, account_name,
      budget: budgetByCamp.get(c.id) ?? null,
      bid: bidByCamp.get(c.id) ?? null,
      status: statusByCamp.get(c.id) ?? null,
      accountId: accountIdByCamp.get(c.id) ?? null,
      adsets,
    };
  });

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  // totalRevenue calculado direto das purchases — não somando das campaigns.
  // Motivo: campaigns vem do Graph e só inclui o que TEM spend no período.
  // Vendas de leads antigos (de campanhas hoje arquivadas/pausadas) não
  // apareceriam na árvore, mas existem no banco. Somar direto garante
  // consistência: totalPurchases reflete o mesmo conjunto que totalRevenue.
  const totalRevenue = purchases.reduce(
    (s, p) => s + Number(p.commission_value ?? p.value),
    0,
  );
  // Faturamento por plataforma × método (origem da venda). source null → Payt.
  const revenueByPlatformMethod = aggregateRevenueByPlatformMethod(purchases);
  const totalLeads = leads.length;
  const totalPurchases = purchases.length;
  // Imposto só sobre a parcela BRL (`taxableSpend`). totalSpend já está em BRL
  // (contas USD convertidas acima), mas contas USD não entram na base do imposto.
  const totalSpendWithTax = totalSpend + taxableSpend * META_TAX_RATE;
  const totalLucro = totalRevenue - totalSpendWithTax;

  // Totais das transações do gateway — mesma definição do Overview.
  const statOf = (rows: PurchaseRow[]): TransactionStat => ({
    count: rows.length,
    value: rows.reduce((s, p) => s + Number(p.commission_value ?? p.value), 0),
  });
  const totalBoletosGerados    = statOf(createdInRange.filter(p => p.payment_method === "boleto"));
  const totalPixGerados        = statOf(createdInRange.filter(p => p.payment_method === "pix"));
  const totalCartoesRecusados  = statOf(createdInRange.filter(p => p.status === "refused"));

  return {
    campaigns, totalSpend, totalSpendWithTax, totalRevenue, revenueByPlatformMethod,
    totalLeads, totalPurchases, totalLucro,
    totalBoletosGerados, totalPixGerados, totalCartoesRecusados,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Listagens paginadas para tabelas de Leads e Vendas.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Detalhes unificados de um registro pro Drawer de Detalhes.
// Aceita: lead.id | purchase.id | events_log.id
// Resolve em cascata por phone: pega lead, purchase mais recente, histórico.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordContext {
  phone: string | null;
  // Lead da pessoa (último/único — fonte de atribuição CTWA)
  lead: {
    id: string;
    ctwa_clid: string | null;
    source_id: string | null;
    source_url: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    ad_id: string | null;
    ad_name: string | null;
    ad_account_id: string | null;
    raw_webhook: Record<string, unknown> | null;
    created_at: string;
  } | null;
  // Account ID Meta (sem prefixo "act_") pra construir URL Ads Manager
  adAccount: { account_id: string; name: string; bm_id: string } | null;
  // Purchase específico (quando focado)
  purchase: {
    id: string;
    transaction_id: string;
    email: string | null;
    product_name: string | null;
    value: number;
    currency: string;
    status: string;
    affiliate_email: string | null;
    matched_lead: boolean;
    raw_webhook: Record<string, unknown> | null;
    created_at: string;
  } | null;
  // Event específico (quando focado em /eventos)
  event: {
    id: string;
    event_name: string;
    event_id: string;
    pixel_id: string | null;
    payload_meta: Record<string, unknown> | null;
    response_meta: Record<string, unknown> | null;
    created_at: string;
  } | null;
  // Histórico de eventos do mesmo phone (Lead + Purchase)
  history: Array<{
    id: string;
    event_name: string;
    response_status: "success" | "error" | "unknown";
    created_at: string;
  }>;
}

export async function getRecordContext(
  supabase: SupabaseClient,
  kind: "lead" | "purchase" | "event",
  id: string,
): Promise<RecordContext | null> {
  // 1. Resolve o registro raiz e o phone
  let phone: string | null = null;
  let lead: RecordContext["lead"] = null;
  let purchase: RecordContext["purchase"] = null;
  let event: RecordContext["event"] = null;

  if (kind === "lead") {
    const { data } = await supabase
      .from("leads")
      .select("id, phone, ctwa_clid, source_id, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, raw_webhook, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const r = data as {
      id: string; phone: string | null;
      ctwa_clid: string | null; source_id: string | null; ad_account_id: string | null;
      campaign_id: string | null; campaign_name: string | null;
      adset_id: string | null; adset_name: string | null;
      ad_id: string | null; ad_name: string | null;
      raw_webhook: Record<string, unknown> | null;
      created_at: string;
    };
    phone = r.phone;
    lead = {
      id: r.id,
      ctwa_clid: r.ctwa_clid,
      source_id: r.source_id,
      source_url: typeof r.raw_webhook === "object" && r.raw_webhook
        ? String((r.raw_webhook as { source_url?: unknown }).source_url ?? "") || null
        : null,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      adset_id: r.adset_id, adset_name: r.adset_name,
      ad_id: r.ad_id, ad_name: r.ad_name,
      ad_account_id: r.ad_account_id,
      raw_webhook: r.raw_webhook,
      created_at: r.created_at,
    };
  } else if (kind === "purchase") {
    const { data } = await supabase
      .from("purchases")
      .select("id, transaction_id, phone, email, product_name, value, currency, status, affiliate_email, matched_lead, raw_webhook, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const r = data as {
      id: string; transaction_id: string; phone: string | null;
      email: string | null; product_name: string | null;
      value: number; currency: string; status: string;
      affiliate_email: string | null; matched_lead: boolean;
      raw_webhook: Record<string, unknown> | null;
      created_at: string;
    };
    phone = r.phone;
    purchase = {
      id: r.id,
      transaction_id: r.transaction_id,
      email: r.email,
      product_name: r.product_name,
      value: r.value,
      currency: r.currency,
      status: r.status,
      affiliate_email: r.affiliate_email,
      matched_lead: r.matched_lead,
      raw_webhook: r.raw_webhook,
      created_at: r.created_at,
    };
  } else {
    const { data } = await supabase
      .from("events_log")
      .select("id, phone, event_name, event_id, pixel_id, payload_meta, response_meta, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const r = data as {
      id: string; phone: string | null; event_name: string; event_id: string;
      pixel_id: string | null;
      payload_meta: Record<string, unknown> | null;
      response_meta: Record<string, unknown> | null;
      created_at: string;
    };
    phone = r.phone;
    event = {
      id: r.id, event_name: r.event_name, event_id: r.event_id,
      pixel_id: r.pixel_id,
      payload_meta: r.payload_meta,
      response_meta: r.response_meta,
      created_at: r.created_at,
    };
  }

  // 2. Se temos phone, busca o lead matching (se ainda não buscado)
  if (phone && !lead) {
    const { data } = await supabase
      .from("leads")
      .select("id, phone, ctwa_clid, source_id, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, raw_webhook, created_at")
      .eq("phone", phone)
      .maybeSingle();
    if (data) {
      const r = data as {
        id: string; phone: string | null;
        ctwa_clid: string | null; source_id: string | null; ad_account_id: string | null;
        campaign_id: string | null; campaign_name: string | null;
        adset_id: string | null; adset_name: string | null;
        ad_id: string | null; ad_name: string | null;
        raw_webhook: Record<string, unknown> | null;
        created_at: string;
      };
      lead = {
        id: r.id,
        ctwa_clid: r.ctwa_clid,
        source_id: r.source_id,
        source_url: typeof r.raw_webhook === "object" && r.raw_webhook
          ? String((r.raw_webhook as { source_url?: unknown }).source_url ?? "") || null
          : null,
        campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        adset_id: r.adset_id, adset_name: r.adset_name,
        ad_id: r.ad_id, ad_name: r.ad_name,
        ad_account_id: r.ad_account_id,
        raw_webhook: r.raw_webhook,
        created_at: r.created_at,
      };
    }
  }

  // 3. Resolve ad_account (pra link Ads Manager)
  let adAccount: RecordContext["adAccount"] = null;
  if (lead?.ad_account_id) {
    const { data } = await supabase
      .from("ad_accounts")
      .select("account_id, name, bm_id")
      .eq("id", lead.ad_account_id)
      .maybeSingle();
    adAccount = (data as RecordContext["adAccount"]) ?? null;
  }

  // 4. Purchase mais recente (se kind != purchase, busca pelo phone pra mostrar)
  if (phone && !purchase) {
    const { data } = await supabase
      .from("purchases")
      .select("id, transaction_id, email, product_name, value, currency, status, affiliate_email, matched_lead, raw_webhook, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      purchase = data as RecordContext["purchase"];
    }
  }

  // 5. Histórico de eventos do mesmo phone
  let history: RecordContext["history"] = [];
  if (phone) {
    const { data } = await supabase
      .from("events_log")
      .select("id, event_name, response_meta, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(30);
    history = ((data ?? []) as Array<{
      id: string; event_name: string;
      response_meta: Record<string, unknown> | null;
      created_at: string;
    }>).map(r => {
      let status: "success" | "error" | "unknown" = "unknown";
      const resp = r.response_meta;
      if (resp && typeof resp === "object") {
        if ("events_received" in resp && Number(resp.events_received) > 0) status = "success";
        else if ("fbtrace_id" in resp) status = "success";
        else if ("error" in resp || "retries_exhausted" in resp) status = "error";
      }
      return { id: r.id, event_name: r.event_name, response_status: status, created_at: r.created_at };
    });
  }

  return { phone, lead, adAccount, purchase, event, history };
}

export interface LeadsListFilters {
  adAccountId?: string | null;
  projectAccountIds?: string[] | null;  // escopo por projeto (migration 020)
  campaignId?: string | null;
  search?: string | null;   // busca parcial por phone (qualquer formato)
  page?: number;
  pageSize?: number;
}

export interface LeadsListResult {
  rows: Record<string, unknown>[];
  total: number;
}

export async function getLeadsList(
  supabase: SupabaseClient,
  from: string,
  to: string,
  filters: LeadsListFilters = {},
): Promise<LeadsListResult> {
  const { adAccountId, projectAccountIds, campaignId, search, page = 0, pageSize = 50 } = filters;
  let query = supabase
    .from("leads")
    .select(
      "id, phone, ctwa_clid, source_id, ad_account_id, campaign_name, adset_name, ad_name, created_at, source_url:raw_webhook->>source_url",
      { count: "estimated" },
    )
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false });
  query = scopeAccount(query, { adAccountFilter: adAccountId, projectAccountIds });
  if (campaignId)  query = query.eq("campaign_id", campaignId);
  // Busca por phone: normaliza pra só dígitos antes do LIKE (user pode
  // colar formato "+55 (11) 99999-9999" ou só os últimos 8 dígitos).
  if (search) {
    const digits = search.replace(/\D/g, "");
    if (digits) query = query.ilike("phone", `%${digits}%`);
  }
  query = query.range(page * pageSize, (page + 1) * pageSize - 1);
  const { data, count } = await query;
  return {
    rows: (data as Record<string, unknown>[]) ?? [],
    total: count ?? 0,
  };
}

export interface PurchasesListFilters {
  status?: "approved" | "refunded" | "pending" | "refused" | "scheduled" | null;
  projectAccountIds?: string[] | null;  // escopo por projeto (migration 020)
  affiliateEmail?: string | null;
  producerOnly?: boolean;   // só vendas do produtor (affiliate_email IS NULL)
  source?: "payt" | "manual" | "luminar-pay" | "skale" | "braip" | null;  // origem: Payt, Luminar-pay, Skale ou lançamento manual
  search?: string | null;   // busca parcial por phone OU email
  page?: number;
  pageSize?: number;
}

export interface PurchasesListResult {
  rows: Record<string, unknown>[];
  total: number;
}

export interface EventsLogListFilters {
  eventName?: "Lead" | "Purchase" | null;
  page?: number;
  pageSize?: number;
}

export interface EventsLogRow {
  id: string;
  phone: string | null;
  event_name: string;
  event_id: string;
  pixel_id: string | null;
  has_payload: boolean;
  has_response: boolean;
  response_status: "success" | "error" | "unknown";
  created_at: string;
}

export async function getEventsLogList(
  supabase: SupabaseClient,
  from: string,
  to: string,
  filters: EventsLogListFilters = {},
): Promise<{ rows: EventsLogRow[]; total: number }> {
  const { eventName, page = 0, pageSize = 50 } = filters;
  let query = supabase
    .from("events_log")
    .select(
      "id, phone, event_name, event_id, pixel_id, payload_meta, response_meta, created_at",
      { count: "estimated" },
    )
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false });
  if (eventName) query = query.eq("event_name", eventName);
  query = query.range(page * pageSize, (page + 1) * pageSize - 1);
  const { data, count } = await query;
  type Raw = {
    id: string; phone: string | null; event_name: string; event_id: string;
    pixel_id: string | null;
    payload_meta: Record<string, unknown> | null;
    response_meta: Record<string, unknown> | null;
    created_at: string;
  };
  const rows: EventsLogRow[] = ((data ?? []) as Raw[]).map(r => {
    const resp = r.response_meta;
    let status: EventsLogRow["response_status"] = "unknown";
    if (resp && typeof resp === "object") {
      if ("events_received" in resp && Number(resp.events_received) > 0) status = "success";
      else if ("error" in resp) status = "error";
      else if ("fbtrace_id" in resp) status = "success";
    }
    return {
      id: r.id,
      phone: r.phone,
      event_name: r.event_name,
      event_id: r.event_id,
      pixel_id: r.pixel_id,
      has_payload: r.payload_meta !== null,
      has_response: r.response_meta !== null,
      response_status: status,
      created_at: r.created_at,
    };
  });
  return { rows, total: count ?? 0 };
}

export async function getEventLogDetails(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  id: string;
  phone: string | null;
  event_name: string;
  event_id: string;
  pixel_id: string | null;
  payload_meta: Record<string, unknown> | null;
  response_meta: Record<string, unknown> | null;
  created_at: string;
} | null> {
  const { data } = await supabase
    .from("events_log")
    .select("id, phone, event_name, event_id, pixel_id, payload_meta, response_meta, created_at")
    .eq("id", id)
    .maybeSingle();
  return data as Awaited<ReturnType<typeof getEventLogDetails>>;
}

export async function getPurchasesList(
  supabase: SupabaseClient,
  from: string,
  to: string,
  filters: PurchasesListFilters = {},
): Promise<PurchasesListResult> {
  const { status, projectAccountIds, affiliateEmail, producerOnly, source, search, page = 0, pageSize = 50 } = filters;
  let query = supabase
    .from("purchases")
    .select(
      "id, transaction_id, phone, email, product_name, value, commission_value, currency, status, affiliate_email, matched_lead, source, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, ad_account_id, created_at, approved_at",
      { count: "estimated" },
    )
    // Range pela data EFETIVA (approved_at, fallback created_at) — a venda
    // aparece na listagem no dia do pagamento. Pendentes/recusadas têm
    // approved_at NULL e caem no fallback created_at naturalmente.
    .or(effectiveDateOr(from, to))
    .order("created_at", { ascending: false });
  query = scopeAccount(query, { projectAccountIds });
  if (status)         query = query.eq("status", status);
  if (source)         query = query.eq("source", source);
  if (producerOnly)   query = query.is("affiliate_email", null);
  else if (affiliateEmail) query = query.eq("affiliate_email", affiliateEmail);
  // Busca: phone (dígitos) OU email (texto livre). Decide pelo conteúdo —
  // se tiver '@' assume email, senão phone (só dígitos).
  if (search) {
    const s = search.trim();
    if (s.includes("@")) {
      query = query.ilike("email", `%${s}%`);
    } else {
      const digits = s.replace(/\D/g, "");
      if (digits) query = query.ilike("phone", `%${digits}%`);
    }
  }
  query = query.range(page * pageSize, (page + 1) * pageSize - 1);
  const { data, count } = await query;
  const rows = (data as Record<string, unknown>[]) ?? [];

  // Atribuição (campaign/adset/ad/ad_account) já vem persistida em purchases
  // via snapshot do webhook (migration 009). Só restam dois enriquecimentos:
  //   1. source_url: ainda lookup em leads.raw_webhook (não duplicado em purchases)
  //   2. meta_account_id/name: lookup em ad_accounts pra montar Ads Manager URL
  const phones = Array.from(
    new Set(
      rows
        .map(r => (r as { phone?: string | null }).phone)
        .filter((p): p is string => !!p),
    ),
  );
  const sourceUrlByPhone = new Map<string, string>();
  if (phones.length > 0) {
    const { data: leadRows } = await supabase
      .from("leads")
      .select("phone, source_url:raw_webhook->>source_url")
      .in("phone", phones);
    for (const l of (leadRows ?? []) as Array<{ phone: string; source_url: string | null }>) {
      if (l.source_url && !sourceUrlByPhone.has(l.phone)) {
        sourceUrlByPhone.set(l.phone, l.source_url);
      }
    }
  }

  const accountIds = Array.from(
    new Set(
      rows
        .map(r => (r as { ad_account_id?: string | null }).ad_account_id)
        .filter((id): id is string => !!id),
    ),
  );
  const accountById = new Map<string, { account_id: string; name: string }>();
  if (accountIds.length > 0) {
    const { data: accRows } = await supabase
      .from("ad_accounts")
      .select("id, account_id, name")
      .in("id", accountIds);
    for (const a of (accRows ?? []) as Array<{ id: string; account_id: string; name: string }>) {
      accountById.set(a.id, { account_id: a.account_id, name: a.name });
    }
  }

  for (const r of rows) {
    const phone = (r as { phone?: string | null }).phone;
    const adAccountId = (r as { ad_account_id?: string | null }).ad_account_id;
    const acc = adAccountId ? accountById.get(adAccountId) : null;
    Object.assign(r, {
      source_url:        phone ? (sourceUrlByPhone.get(phone) ?? null) : null,
      meta_account_id:   acc?.account_id ?? null,
      meta_account_name: acc?.name       ?? null,
    });
  }

  return { rows, total: count ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregação geográfica de vendas — usado pelo cartograma + top cidades em
// /dashboard/vendas. Lê billing_address direto do raw_webhook pra capturar
// dados que não temos em coluna própria.
// ─────────────────────────────────────────────────────────────────────────────

const UF_NAMES_TO_CODES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA",
  ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR",
  pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO",
  roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE",
  tocantins: "TO",
};
const VALID_UFS = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB",
  "PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

function normalizeUF(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase();
  if (s.length === 2 && VALID_UFS.has(s.toUpperCase())) return s.toUpperCase();
  return UF_NAMES_TO_CODES[s] ?? null;
}

function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Title Case Unicode-safe. Regex \b\w sem flag /u quebra com letras
  // acentuadas: em "são", o ã não é \w → cria boundary → "O" vira
  // maiúsculo ("SãO"). Lowercase tudo + capitalize só primeira letra de
  // cada palavra (split por espaço) evita o bug.
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface SalesLocationResult {
  byState: Array<{ uf: string; count: number; revenue: number }>;
  byCity: Array<{ city: string; uf: string | null; count: number; revenue: number }>;
  totalWithGeo: number;
  totalWithoutGeo: number;
}

export async function getSalesByLocation(
  supabase: SupabaseClient,
  from: string,
  to: string,
  filters: { affiliateEmail?: string | null; producerOnly?: boolean; projectAccountIds?: string[] | null } = {},
): Promise<SalesLocationResult> {
  const rows = await fetchAllPaginated<{
    value: number;
    commission_value: number | null;
    raw_webhook: Record<string, unknown> | null;
  }>(() => {
    let q = supabase
      .from("purchases")
      .select("value, commission_value, raw_webhook")
      .or(effectiveDateOr(from, to))
      .eq("status", "approved");
    q = scopeAccount(q, { projectAccountIds: filters.projectAccountIds });
    if (filters.producerOnly) q = q.is("affiliate_email", null);
    else if (filters.affiliateEmail) q = q.eq("affiliate_email", filters.affiliateEmail);
    return q;
  });

  const byUF = new Map<string, { count: number; revenue: number }>();
  const byCityKey = new Map<string, { city: string; uf: string | null; count: number; revenue: number }>();
  let totalWithGeo = 0;
  let totalWithoutGeo = 0;

  for (const r of rows) {
    const val = Number(r.commission_value ?? r.value);
    const wh = r.raw_webhook as
      | { customer?: { billing_address?: { city?: string; state?: string; estate?: string } } }
      | null;
    const addr = wh?.customer?.billing_address;
    const uf = normalizeUF(addr?.estate ?? addr?.state ?? null);
    const city = normalizeCity(addr?.city ?? null);

    if (uf) {
      const cur = byUF.get(uf) ?? { count: 0, revenue: 0 };
      byUF.set(uf, { count: cur.count + 1, revenue: cur.revenue + val });
      totalWithGeo++;
    } else {
      totalWithoutGeo++;
    }

    if (city) {
      const key = `${city}|${uf ?? ""}`;
      const cur = byCityKey.get(key) ?? { city, uf, count: 0, revenue: 0 };
      byCityKey.set(key, { ...cur, count: cur.count + 1, revenue: cur.revenue + val });
    }
  }

  const byState = Array.from(byUF.entries())
    .map(([uf, v]) => ({ uf, ...v }))
    .sort((a, b) => b.count - a.count);
  const byCity = Array.from(byCityKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { byState, byCity, totalWithGeo, totalWithoutGeo };
}

/**
 * Lista de afiliados (e-mails únicos) que tiveram pelo menos 1 venda no
 * período. Usado pelo dropdown de filtro em /dashboard/vendas.
 */
export async function getDistinctAffiliates(
  supabase: SupabaseClient,
  from: string,
  to: string,
  projectAccountIds?: string[] | null,
): Promise<string[]> {
  const rows = await fetchAllPaginated<{ affiliate_email: string }>(() =>
    scopeAccount(
      supabase
        .from("purchases")
        .select("affiliate_email")
        .or(effectiveDateOr(from, to))
        .not("affiliate_email", "is", null),
      { projectAccountIds },
    ),
  );
  return Array.from(new Set(rows.map(r => r.affiliate_email))).sort();
}
