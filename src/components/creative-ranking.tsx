"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CreativeRow } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { ExternalLink, Search, X, Trophy, TrendingUp, ShoppingCart, ImageOff } from "lucide-react";

// ── Ordenação ────────────────────────────────────────────────────────────────
type SortKey = "purchases" | "roas" | "revenue" | "lucro" | "spend" | "leads" | "cpa";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "purchases", label: "Vendas" },
  { key: "roas",      label: "ROAS" },
  { key: "revenue",   label: "Faturamento" },
  { key: "lucro",     label: "Lucro" },
  { key: "spend",     label: "Investido" },
  { key: "leads",     label: "Leads" },
  { key: "cpa",       label: "CPA (menor)" },
];

// Valor efetivo pra ordenar. CPA sem venda vai pro fim (pior), não pro topo.
function sortValue(r: CreativeRow, key: SortKey): number {
  if (key === "cpa") return r.purchases > 0 ? r.cpa : Number.POSITIVE_INFINITY;
  return r[key];
}
function compare(a: CreativeRow, b: CreativeRow, key: SortKey): number {
  const av = sortValue(a, key), bv = sortValue(b, key);
  return key === "cpa" ? av - bv : bv - av; // CPA: menor é melhor; resto: maior
}

function best(arr: CreativeRow[], sel: (r: CreativeRow) => number): CreativeRow | null {
  let top: CreativeRow | null = null, topV = -Infinity;
  for (const r of arr) { const v = sel(r); if (v > topV) { topV = v; top = r; } }
  return top;
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── Miniatura do criativo ────────────────────────────────────────────────────
// Meta CDN pede no-referrer pra servir cross-origin. Sem thumbnail (ou anúncio
// sem creative_id legível) mostra um placeholder.
function Thumb({ src, alt, size = 44 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="shrink-0 rounded-md bg-muted/40 border border-border/40 flex items-center justify-center text-muted-foreground/40"
        style={{ width: size, height: size }}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md border border-border/40 object-cover bg-muted/30"
      style={{ width: size, height: size }}
    />
  );
}

// ── Pódio (destaques) ────────────────────────────────────────────────────────
function PodiumCard({
  label, creative, stat, sub, icon: Icon, accent,
}: {
  label: string; creative: CreativeRow | null; stat: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      </div>
      {creative ? (
        <>
          <div className="flex items-start gap-2.5">
            <Thumb src={creative.thumbnailUrl} alt={creative.name} size={40} />
            <p className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]" title={creative.name}>
              {creative.name}
            </p>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-lg font-mono font-semibold ${accent}`}>{stat}</span>
            {sub && <span className="text-[11px] font-mono text-muted-foreground">{sub}</span>}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground/60 min-h-[2.5rem] flex items-center">Sem dados no período.</p>
      )}
    </div>
  );
}

// ── Badge de posição ─────────────────────────────────────────────────────────
function RankBadge({ pos }: { pos: number }) {
  const medal =
    pos === 1 ? "bg-[#FBBF24]/15 text-[#F59E0B] border-[#F59E0B]/30" :
    pos === 2 ? "bg-[#CBD5E1]/15 text-[#94A3B8] border-[#94A3B8]/30" :
    pos === 3 ? "bg-[#D97706]/15 text-[#C2721A] border-[#C2721A]/30" :
    "bg-muted/40 text-muted-foreground border-border/50";
  return (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-mono font-semibold tabular ${medal}`}>
      {pos}
    </span>
  );
}

// ── Célula de métrica ────────────────────────────────────────────────────────
function Cell({ value, sub, tone, active }: { value: string; sub?: string; tone?: string; active?: boolean }) {
  return (
    <div className="text-right whitespace-nowrap">
      <span className={`text-[13px] font-mono tabular ${active ? "font-semibold" : ""} ${tone ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="block text-[10px] font-mono text-muted-foreground/70 mt-0.5">{sub}</span>}
    </div>
  );
}

const GRID = "44px minmax(220px,1.7fr) 104px 104px 116px 124px 118px 84px";

export function CreativeRanking({ creatives, baseQuery = "" }: { creatives: CreativeRow[]; baseQuery?: string }) {
  const [sort, setSort] = useState<SortKey>("purchases");
  const [minSpend, setMinSpend] = useState(0);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    let list = creatives;
    if (minSpend > 0) list = list.filter(r => r.spend >= minSpend);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(r => r.key.includes(q));
    return [...list].sort((a, b) => compare(a, b, sort));
  }, [creatives, minSpend, query, sort]);

  // Máximo do metric ativo pra barra relativa (ignora o Infinity do CPA e, pra
  // CPA, usa o inverso — barra maior = melhor, ou seja, menor custo).
  const maxVal = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const v = sortValue(r, sort);
      if (Number.isFinite(v) && v > m) m = v;
    }
    return m;
  }, [rows, sort]);
  const barWidth = (r: CreativeRow): number => {
    if (maxVal <= 0) return 0;
    const v = sortValue(r, sort);
    if (!Number.isFinite(v)) return 0;
    const frac = sort === "cpa" ? 1 - v / maxVal : v / maxVal; // CPA: menor custo = barra maior
    return Math.max(0, Math.min(1, frac)) * 100;
  };

  // Pódio — sempre do conjunto COMPLETO (não filtrado), pra ser "o melhor no
  // período". "Melhor ROAS" exige gasto acima da mediana dos que venderam, pra
  // não premiar um criativo de gasto ínfimo com 1 venda.
  const topSales = useMemo(() => best(creatives, r => r.purchases), [creatives]);
  const topLucro = useMemo(() => best(creatives, r => r.lucro), [creatives]);
  const topRoas = useMemo(() => {
    const sellers = creatives.filter(r => r.spend > 0 && r.purchases > 0);
    const floor = median(sellers.map(r => r.spend));
    const eligible = sellers.filter(r => r.spend >= floor);
    return best(eligible.length ? eligible : sellers, r => r.roas);
  }, [creatives]);

  const totalCreatives = creatives.length;

  return (
    <div className="space-y-5">
      {/* Pódio */}
      <div className="grid gap-3 sm:grid-cols-3">
        <PodiumCard
          label="Mais vendas" icon={ShoppingCart} accent="text-primary"
          creative={topSales}
          stat={topSales ? `${topSales.purchases} vendas` : "—"}
          sub={topSales && topSales.roas > 0 ? `ROAS ${topSales.roas.toFixed(2)}×` : undefined}
        />
        <PodiumCard
          label="Melhor ROAS" icon={Trophy} accent="text-[hsl(var(--accent-cyan))]"
          creative={topRoas}
          stat={topRoas ? `${topRoas.roas.toFixed(2)}×` : "—"}
          sub={topRoas ? `${formatCurrency(topRoas.spend)} · ${topRoas.purchases} vendas` : undefined}
        />
        <PodiumCard
          label="Maior lucro" icon={TrendingUp} accent="text-primary"
          creative={topLucro}
          stat={topLucro ? formatCurrency(topLucro.lucro) : "—"}
          sub={topLucro && topLucro.spend > 0 ? `ROAS ${topLucro.roas.toFixed(2)}×` : undefined}
        />
      </div>

      {/* Tabela */}
      <div className="rounded-lg border border-border/60 bg-card">
        <div className="flex flex-col gap-3 p-4 border-b border-border/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Ranking de criativos</h2>
              <span className="text-[11px] font-mono text-muted-foreground">
                {rows.length === totalCreatives ? totalCreatives : `${rows.length} de ${totalCreatives}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro por nome */}
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3 w-3 text-muted-foreground/60 pointer-events-none" strokeWidth={2} />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Filtrar criativo…"
                  aria-label="Filtrar criativos por nome"
                  className="h-8 pl-7 pr-7 w-44 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Limpar" className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {/* Gasto mínimo */}
              <div className="inline-flex items-center h-8 rounded-md border border-border/80 bg-background/50 overflow-hidden">
                <span className="pl-2.5 pr-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70">Gasto mín. R$</span>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={minSpend || ""}
                  onChange={e => setMinSpend(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  aria-label="Gasto mínimo"
                  className="h-full w-16 pr-2 text-[11px] font-mono bg-transparent text-foreground text-right focus:outline-none"
                />
              </div>
            </div>
          </div>
          {/* Ordenar por */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70 mr-1">Ordenar por</span>
            {SORTS.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={`h-7 px-2.5 rounded-md text-[11px] transition-colors ${
                  sort === s.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: 900 }}>
            {/* Cabeçalho */}
            <div
              className="grid gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30 items-center"
              style={{ gridTemplateColumns: GRID }}
            >
              <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70 text-center">#</span>
              <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70">Criativo</span>
              {(["spend", "leads", "purchases", "revenue", "lucro", "roas"] as const).map(k => (
                <span key={k} className={`text-[9px] font-mono uppercase tracking-[0.12em] text-right ${sort === k ? "text-primary" : "text-muted-foreground/70"}`}>
                  {k === "spend" ? "Investido" : k === "leads" ? "Leads" : k === "purchases" ? "Vendas" : k === "revenue" ? "Faturam." : k === "lucro" ? "Lucro" : "ROAS"}
                </span>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                {totalCreatives === 0
                  ? "Nenhum criativo com gasto ou venda no período."
                  : "Nenhum criativo com esse filtro."}
              </div>
            ) : (
              rows.map((r, i) => {
                const roasColor =
                  r.roas >= 1 ? "text-[hsl(var(--accent-cyan))]" :
                  r.roas > 0  ? "text-muted-foreground" : "text-muted-foreground/50";
                const lucroColor =
                  r.lucro > 0 ? "text-primary" : r.lucro < 0 ? "text-destructive" : "text-muted-foreground";
                const w = barWidth(r);
                return (
                  <div
                    key={r.key}
                    className="grid gap-2 px-4 py-3 border-b border-border/30 hover:bg-accent/20 items-center transition-colors"
                    style={{ gridTemplateColumns: GRID }}
                  >
                    <div className="flex justify-center"><RankBadge pos={i + 1} /></div>
                    {/* Criativo: miniatura + nome + barra relativa + meta */}
                    <div className="min-w-0 pr-2 flex items-start gap-2.5">
                      <Thumb src={r.thumbnailUrl} alt={r.name} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Link
                            href={`/dashboard/campanhas?${r.creativeId ? `creativeId=${encodeURIComponent(r.creativeId)}` : `creative=${encodeURIComponent(r.name)}`}${baseQuery ? `&${baseQuery}` : ""}`}
                            title={`Ver "${r.name}" nas campanhas`}
                            className="truncate text-[13px] font-medium hover:text-primary hover:underline transition-colors"
                          >
                            {r.name}
                          </Link>
                          {r.creativeLink && (
                            <a href={r.creativeLink} target="_blank" rel="noopener noreferrer" title="Ver criativo no Meta" className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-primary hover:bg-primary/10 transition-colors">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1 flex-1 rounded-full bg-muted/50 overflow-hidden max-w-[220px]">
                            <div className="h-full rounded-full bg-primary/60" style={{ width: `${w}%` }} />
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground/70">
                          <span>{r.campaignCount} camp.</span>
                          <span>·</span>
                          <span>{r.adCount} anúncio{r.adCount > 1 ? "s" : ""}</span>
                          {r.activeCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-primary/80">{r.activeCount} ativo{r.activeCount > 1 ? "s" : ""}</span>
                            </>
                          )}
                          {r.accountNames.length === 1 && (
                            <><span>·</span><span className="truncate max-w-[140px]" title={r.accountNames[0]}>{r.accountNames[0]}</span></>
                          )}
                          {r.accountNames.length > 1 && (
                            <><span>·</span><span>{r.accountNames.length} contas</span></>
                          )}
                        </div>
                      </div>
                    </div>
                    <Cell value={r.spend > 0 ? formatCurrency(r.spend) : "—"} active={sort === "spend"} />
                    <Cell value={r.leads > 0 ? r.leads.toLocaleString("pt-BR") : "—"} sub={r.cpl > 0 ? formatCurrency(r.cpl) : undefined} active={sort === "leads"} />
                    <Cell value={r.purchases > 0 ? r.purchases.toLocaleString("pt-BR") : "—"} sub={r.cpa > 0 ? formatCurrency(r.cpa) : undefined} active={sort === "purchases" || sort === "cpa"} />
                    <Cell value={r.revenue > 0 ? formatCurrency(r.revenue) : "—"} active={sort === "revenue"} />
                    <Cell value={r.lucro !== 0 ? formatCurrency(r.lucro) : "—"} tone={lucroColor} active={sort === "lucro"} />
                    <Cell value={r.roas > 0 ? `${r.roas.toFixed(2)}×` : "—"} tone={roasColor} active={sort === "roas"} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
