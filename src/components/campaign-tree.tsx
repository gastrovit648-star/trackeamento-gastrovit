"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { creativeKey, formatCurrency } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowRight, ExternalLink, Pencil, Search, Loader2, Trophy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties,
} from "react";
import type { CampaignNode, CampaignWithChildren } from "@/lib/queries";

interface Props {
  campaigns: CampaignWithChildren[];
  initialCreative?: string;    // deep-link por NOME (fallback)
  initialCreativeId?: string;  // deep-link por creative_id (preciso)
  clearCreativeHref?: string;  // URL desta página sem ?creative — pro "ver tudo"
}

// ─────────────────────────────────────────────────────────────────────────────
// Colunas — largura ajustável arrastando a alça na borda direita do cabeçalho.
//
// A grid deixou de usar classe Tailwind estática (`grid-cols-[…]`) porque as
// larguras agora são estado do React: o template vai por `style` e é publicado
// via contexto pras linhas aninhadas (campanha → conjunto → anúncio), evitando
// prop drilling. `min` é o limite de arraste; `def` é a largura inicial e o
// valor restaurado no clique duplo da alça.
// ─────────────────────────────────────────────────────────────────────────────

// Ordem: identidade | Orçamento | Lance | Gasto | Vendas | CPA | Faturamento |
// Lucro | ROAS | Agendamento | CPA Agend. | Leads | CPL | Boletos | PIX Ger |
// Recusados | Conta.
// CPL e CPA são colunas próprias (antes eram sub-texto de Leads/Vendas).
const COLUMNS = [
  { key: "name",         min: 200, def: 340 },
  { key: "budget",       min: 90,  def: 110 },
  { key: "bid",          min: 85,  def: 100 },
  { key: "spend",        min: 80,  def: 100 },
  { key: "purchases",    min: 70,  def: 90  },
  { key: "cpa",          min: 75,  def: 90  },
  { key: "revenue",      min: 95,  def: 115 },
  { key: "lucro",        min: 80,  def: 110 },
  { key: "roas",           min: 60,  def: 80  },
  { key: "agendamentos",    min: 95,  def: 110 },
  { key: "roasAgendamento", min: 80,  def: 95  },
  { key: "cpaAgendamento",  min: 90,  def: 105 },
  { key: "leads",          min: 70,  def: 85  },
  { key: "cpl",          min: 70,  def: 85  },
  { key: "boletos",      min: 70,  def: 85  },
  { key: "pixGerados",   min: 70,  def: 85  },
  { key: "recusados",    min: 85,  def: 95  },
  { key: "account",      min: 90,  def: 150 },
] as const;

const GAP_PX     = 8;   // gap-2 entre colunas
const ROW_PAD_PX = 24;  // px-3 nas duas pontas da linha

// v6: nova coluna CPA AGENDAMENTO depois de AGENDAMENTO (17 larguras, antes 16).
// Key nova evita ler um layout salvo com contagem/ordem antigas.
const STORAGE_KEY = "tracking:campaign-tree:col-widths:v6";

// Template da grid compartilhado com as linhas aninhadas.
const GridStyleCtx = createContext<CSSProperties>({});

function useGridStyle() {
  return useContext(GridStyleCtx);
}

function useColumnWidths() {
  const [widths, setWidths] = useState<number[]>(() => COLUMNS.map(c => c.def));
  // Espelho síncrono do estado: o handler de arraste roda fora do ciclo de
  // render e precisa da largura corrente sem esperar o re-render.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // localStorage só depois da hidratação — ler no initializer do useState
  // divergiria do HTML renderizado no servidor.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (
        Array.isArray(saved) &&
        saved.length === COLUMNS.length &&
        saved.every(n => typeof n === "number" && Number.isFinite(n))
      ) {
        setWidths((saved as number[]).map((w, i) => Math.max(COLUMNS[i].min, w)));
      }
    } catch {
      // storage bloqueado ou JSON corrompido — segue com os defaults
    }
  }, []);

  const commit = (next: number[]) => {
    widthsRef.current = next;
    setWidths(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage indisponível: a largura vale só nesta sessão
    }
  };

  const startResize = (index: number, startX: number) => {
    const startW = widthsRef.current[index];
    let latest = startW;

    const onMove = (ev: PointerEvent) => {
      latest = Math.max(COLUMNS[index].min, Math.round(startW + ev.clientX - startX));
      setWidths(prev => {
        if (prev[index] === latest) return prev;
        const copy = [...prev];
        copy[index] = latest;
        return copy;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const final = [...widthsRef.current];
      final[index] = latest;
      commit(final);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Sem isso o arraste seleciona o texto das linhas e o cursor pisca ao
    // sair de cima da alça.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const resetColumn = (index: number) => {
    const next = [...widthsRef.current];
    next[index] = COLUMNS[index].def;
    commit(next);
  };

  const resetAll = () => commit(COLUMNS.map(c => c.def));

  const isCustom = widths.some((w, i) => w !== COLUMNS[i].def);

  return { widths, startResize, resetColumn, resetAll, isCustom };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtro por nome da campanha.
//
// Client-side de propósito: a árvore já recebe todas as campanhas por prop, e
// filtrar via query param (padrão do SearchInput das telas de Leads/Vendas)
// recarregaria a Graph API do Meta a cada tecla. Aqui o filtro é instantâneo.
//
// Só o nível campanha é filtrado — conjuntos e anúncios da campanha que passou
// continuam todos visíveis ao expandir.
// ─────────────────────────────────────────────────────────────────────────────

type MatchMode = "phrase" | "any";

const MATCH_LABELS: Record<MatchMode, { label: string; hint: string }> = {
  phrase: {
    label: "Exata",
    hint: "O nome contém o texto exatamente como digitado, na mesma ordem",
  },
  any: {
    label: "Qualquer",
    hint: "O nome contém pelo menos um dos termos digitados",
  },
};

// Ignora acento e caixa: "colageno" acha "Colágeno", "PUBLICO" acha "Público".
// Nome de campanha em pt-BR quase sempre tem acento e ninguém digita acento
// numa caixa de busca.
function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Retorna null quando não há termo — caller trata como "sem filtro". */
function makeNameFilter(query: string, mode: MatchMode): ((name: string) => boolean) | null {
  const q = norm(query).trim();
  if (!q) return null;
  if (mode === "phrase") return (name) => norm(name).includes(q);
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  return (name) => {
    const n = norm(name);
    return terms.some(t => n.includes(t));
  };
}

// Filtro por status (ACTIVE/PAUSED). Aplicado em TODOS os níveis: esconde
// campanhas fora do filtro e, dentro das que ficam, conjuntos e anúncios fora
// dele. Status null (phantom/arquivada sem status do Meta) só aparece em "all".
type StatusFilter = "all" | "active" | "paused";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Todas", active: "Ativas", paused: "Pausadas",
};

function matchStatus(status: string | null | undefined, f: StatusFilter): boolean {
  if (f === "all") return true;
  return f === "active" ? status === "ACTIVE" : status === "PAUSED";
}

type SortKey =
  | "spend" | "leads" | "cpl" | "purchases" | "cpa"
  | "boletos" | "pixGerados" | "recusados" | "agendamentos" | "roasAgendamento" | "cpaAgendamento"
  | "revenue" | "lucro" | "roas";

type SortState = { key: SortKey; dir: "desc" | "asc" };

const SORT_LABELS: Record<SortKey, string> = {
  spend: "Investido",
  leads: "Leads",
  cpl: "CPL",
  purchases: "Vendas",
  cpa: "CPA",
  boletos: "Boletos",
  pixGerados: "PIX gerados",
  recusados: "Recusados",
  agendamentos: "Agendamentos",
  roasAgendamento: "ROAS Agendamento",
  cpaAgendamento: "CPA Agendamento",
  revenue: "Faturamento",
  lucro: "Lucro",
  roas: "ROAS",
};

// Métricas de razão: 0 significa "sem dado" (—), então vai pro fim da lista
// independente da direção — senão "menor CPA" viraria uma lista de zeros.
const RATIO_KEYS: SortKey[] = ["cpl", "cpa", "roas", "cpaAgendamento", "roasAgendamento"];

function makeComparator({ key, dir }: SortState) {
  const missing = (v: number) => RATIO_KEYS.includes(key) && v <= 0;
  return (a: CampaignNode, b: CampaignNode) => {
    const av = a[key], bv = b[key];
    if (missing(av) !== missing(bv)) return missing(av) ? 1 : -1;
    return dir === "desc" ? bv - av : av - bv;
  };
}

function MetricCell({ value, sub, accent }: { value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="text-center whitespace-nowrap">
      <span className={`text-xs font-mono tabular ${accent ? "text-foreground font-semibold" : "text-foreground/90"}`}>
        {value}
      </span>
      {sub && (
        <span className="block text-[10px] font-mono text-muted-foreground/70 mt-0.5">
          {sub}
        </span>
      )}
    </div>
  );
}

// Conta de anúncio dona da campanha. Conjunto e anúncio herdam o valor do pai,
// então vêm esmaecidos (`dim`) — repetem o dado só pra manter o contexto quando
// a árvore está muito expandida.
function AccountCell({ name, dim }: { name?: string | null; dim?: boolean }) {
  return (
    <div className="min-w-0">
      <span
        className={`block truncate text-[11px] ${dim ? "text-muted-foreground/45" : "text-muted-foreground"}`}
        title={name ?? undefined}
      >
        {name || "—"}
      </span>
    </div>
  );
}

const fmtBudget = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Orçamento na moeda nativa da conta (não convertido). Valor em cima, tipo
// (diário/total) embaixo em cinza claro — mesmo padrão visual do CPL/CPA.
// "—" quando o nível não define orçamento próprio. Editável (Fase 2) quando há
// metaId + level: a célula vira um input que envia o novo valor pro Meta.
function BudgetCell({
  budget,
  metaId,
  level,
}: {
  budget: CampaignNode["budget"];
  metaId?: string;
  level?: "campaign" | "adset";
}) {
  if (!budget) {
    return (
      <div className="text-center whitespace-nowrap">
        <span className="text-xs font-mono text-muted-foreground/50">—</span>
      </div>
    );
  }
  if (metaId && level) {
    return <EditableBudget budget={budget} metaId={metaId} level={level} />;
  }
  // Fallback view-only (não deveria ocorrer com budget presente).
  const sym = budget.currency === "USD" ? "US$" : "R$";
  const label = budget.kind === "daily" ? "diário" : "total";
  return (
    <div className="text-center whitespace-nowrap" title={`${sym} ${fmtBudget(budget.value)} ${label}`}>
      <span className="text-xs font-mono tabular text-foreground/90">{sym} {fmtBudget(budget.value)}</span>
      <span className="block text-[10px] font-mono text-muted-foreground/70 mt-0.5">{label}</span>
    </div>
  );
}

// Célula de orçamento editável. Clica → input com o valor atual → Enter/✓ pede
// confirmação (é dinheiro real) e envia pro Meta. stopPropagation em tudo pra
// o clique não expandir/colapsar a linha da árvore.
function EditableBudget({
  budget,
  metaId,
  level,
}: {
  budget: NonNullable<CampaignNode["budget"]>;
  metaId: string;
  level: "campaign" | "adset";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const sym = budget.currency === "USD" ? "US$" : "R$";
  const label = budget.kind === "daily" ? "diário" : "total";

  // Popover fixo (fixed) ancorado no valor. Fecha ao rolar/redimensionar pra
  // não ficar deslocado, já que a posição é calculada no clique.
  useEffect(() => {
    if (!open) return;
    const onMove = () => setOpen(false);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const openPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const W = 232;
      const H = 180;  // altura aproximada da caixinha (título + atual + input + botões)
      const left = Math.min(rect.left, window.innerWidth - W - 8);
      // Abre pra baixo por padrão; se a linha está perto do fim da tela e a
      // caixinha estouraria embaixo, abre pra CIMA pra o "Salvar" ficar visível.
      const below = rect.bottom + 6;
      const flipUp = below + H > window.innerHeight - 8;
      const top = flipUp ? Math.max(8, rect.top - H - 6) : below;
      setPos({ top, left: Math.max(8, left) });
    }
    setValue(String(budget.value));
    setError(null);
    setOpen(true);
  };

  const close = () => { setOpen(false); setError(null); };

  async function submit() {
    const novo = Number(value.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(novo) || novo <= 0) { setError("Valor inválido"); return; }
    if (novo === budget.value) { close(); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: budget.accountId, metaId, level, budgetKind: budget.kind, value: novo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Falha ao alterar.");
        setLoading(false);
        return;
      }
      // Sucesso: fecha e para o spinner ANTES do refresh (router.refresh não
      // reseta o estado local). A API invalidou o cache, o refresh traz o novo.
      setLoading(false);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setLoading(false);
    }
  }

  return (
    <div className="text-center whitespace-nowrap">
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        title="Alterar orçamento"
        className={`group/bud inline-flex flex-col items-center leading-tight transition-colors ${open ? "text-primary" : "hover:text-primary"}`}
      >
        <span className="inline-flex items-center gap-1 text-xs font-mono tabular text-foreground/90 group-hover/bud:text-primary">
          {sym} {fmtBudget(budget.value)}
          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/bud:opacity-70 transition-opacity" />
        </span>
        <span className="block text-[10px] font-mono text-muted-foreground/70">{label}</span>
      </button>

      {open && createPortal(
        <>
          {/* Overlay transparente — clicar fora fecha. */}
          <div className="fixed inset-0 z-[200]" onClick={close} />
          {/* Caixinha ancorada no valor (estilo Facebook). */}
          <div
            className="fixed z-[201] w-[232px] rounded-lg border border-border bg-card p-3 shadow-xl text-left"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-medium text-foreground">Orçamento {label}</div>
            <div className="text-[10px] text-muted-foreground mb-2">Atual: {sym} {fmtBudget(budget.value)}</div>
            <div className="flex items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 focus-within:ring-1 focus-within:ring-ring">
              <span className="text-xs font-mono text-muted-foreground shrink-0">{sym}</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={value}
                disabled={loading}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }}
                className="h-8 w-full min-w-0 bg-transparent text-sm font-mono text-foreground focus:outline-none"
              />
            </div>
            {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={close}
                disabled={loading}
                className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={loading || !value.trim()}
                className="h-7 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── Limite de lance (bid_amount) — só onde existe (bid cap). Editável igual o
// orçamento (POST /api/campaigns/bid). "—" onde não há. ────────────────────────
function BidCell({ bid, metaId }: { bid: CampaignNode["bid"]; metaId?: string }) {
  if (!bid) {
    return (
      <div className="text-center whitespace-nowrap">
        <span className="text-xs font-mono text-muted-foreground/50">—</span>
      </div>
    );
  }
  if (metaId) return <EditableBid bid={bid} metaId={metaId} />;
  const sym = bid.currency === "USD" ? "US$" : "R$";
  return (
    <div className="text-center whitespace-nowrap">
      <span className="text-xs font-mono tabular text-foreground/90">{sym} {fmtBudget(bid.value)}</span>
    </div>
  );
}

function EditableBid({ bid, metaId }: { bid: NonNullable<CampaignNode["bid"]>; metaId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const sym = bid.currency === "USD" ? "US$" : "R$";

  useEffect(() => {
    if (!open) return;
    const onMove = () => setOpen(false);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const openPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const W = 232;
      const H = 170;
      const left = Math.min(rect.left, window.innerWidth - W - 8);
      const below = rect.bottom + 6;
      const flipUp = below + H > window.innerHeight - 8;
      const top = flipUp ? Math.max(8, rect.top - H - 6) : below;
      setPos({ top, left: Math.max(8, left) });
    }
    setValue(String(bid.value));
    setError(null);
    setOpen(true);
  };

  const close = () => { setOpen(false); setError(null); };

  async function submit() {
    const novo = Number(value.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(novo) || novo <= 0) { setError("Valor inválido"); return; }
    if (novo === bid.value) { close(); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: bid.accountId, metaId, value: novo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Falha ao alterar."); setLoading(false); return; }
      setLoading(false);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setLoading(false);
    }
  }

  return (
    <div className="text-center whitespace-nowrap">
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        title="Alterar limite de lance"
        className={`group/bid inline-flex items-center leading-tight transition-colors ${open ? "text-primary" : "hover:text-primary"}`}
      >
        <span className="inline-flex items-center gap-1 text-xs font-mono tabular text-foreground/90 group-hover/bid:text-primary">
          {sym} {fmtBudget(bid.value)}
          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/bid:opacity-70 transition-opacity" />
        </span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={close} />
          <div
            className="fixed z-[201] w-[232px] rounded-lg border border-border bg-card p-3 shadow-xl text-left"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-medium text-foreground">Limite de lance</div>
            <div className="text-[10px] text-muted-foreground mb-2">Atual: {sym} {fmtBudget(bid.value)}</div>
            <div className="flex items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 focus-within:ring-1 focus-within:ring-ring">
              <span className="text-xs font-mono text-muted-foreground shrink-0">{sym}</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={value}
                disabled={loading}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }}
                className="h-8 w-full min-w-0 bg-transparent text-sm font-mono text-foreground focus:outline-none"
              />
            </div>
            {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={close} disabled={loading}
                className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:bg-accent/50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={submit} disabled={loading || !value.trim()}
                className="h-7 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function MetricsRow({
  row,
  dimAccount,
  budgetLevel,
}: {
  row: CampaignNode;
  dimAccount?: boolean;
  budgetLevel?: "campaign" | "adset";
}) {
  const lucroColor =
    row.lucro > 0  ? "text-primary" :
    row.lucro < 0  ? "text-destructive" :
                     "text-muted-foreground";
  const roasColor =
    row.roas >= 1  ? "text-[hsl(var(--accent-cyan))]" :
    row.roas > 0   ? "text-muted-foreground" :
                     "text-muted-foreground/60";
  return (
    <>
      <BudgetCell budget={row.budget} metaId={row.id} level={budgetLevel} />
      <BidCell bid={row.bid} metaId={row.id} />
      <MetricCell value={row.spend > 0 ? formatCurrency(row.spend) : "—"} />
      <MetricCell value={row.purchases > 0 ? row.purchases.toLocaleString("pt-BR") : "—"} />
      <MetricCell value={row.cpa > 0 ? formatCurrency(row.cpa) : "—"} />
      <MetricCell value={row.revenue > 0 ? formatCurrency(row.revenue) : "—"} accent />
      <div className="text-center whitespace-nowrap">
        <span className={`text-xs font-mono tabular font-semibold ${lucroColor}`}>
          {row.lucro !== 0 ? formatCurrency(row.lucro) : "—"}
        </span>
      </div>
      <div className="text-center whitespace-nowrap">
        <span className={`text-xs font-mono tabular font-semibold ${roasColor}`}>
          {row.roas > 0 ? `${row.roas.toFixed(2)}×` : "—"}
        </span>
      </div>
      <div className="text-center whitespace-nowrap">
        <span className={`text-xs font-mono tabular font-semibold ${row.agendamentos > 0 ? "text-[hsl(var(--accent-amber))]" : "text-muted-foreground/60"}`}>
          {row.agendamentos > 0 ? row.agendamentos.toLocaleString("pt-BR") : "—"}
        </span>
      </div>
      <div className="text-center whitespace-nowrap">
        <span className={`text-xs font-mono tabular font-semibold ${
          row.roasAgendamento >= 1 ? "text-[hsl(var(--accent-amber))]" :
          row.roasAgendamento > 0  ? "text-muted-foreground" :
                                     "text-muted-foreground/60"}`}>
          {row.roasAgendamento > 0 ? `${row.roasAgendamento.toFixed(2)}×` : "—"}
        </span>
      </div>
      <MetricCell value={row.cpaAgendamento > 0 ? formatCurrency(row.cpaAgendamento) : "—"} />
      <MetricCell value={row.leads > 0 ? row.leads.toLocaleString("pt-BR") : "—"} />
      <MetricCell value={row.cpl > 0 ? formatCurrency(row.cpl) : "—"} />
      <MetricCell value={row.boletos > 0 ? row.boletos.toLocaleString("pt-BR") : "—"} />
      <MetricCell value={row.pixGerados > 0 ? row.pixGerados.toLocaleString("pt-BR") : "—"} />
      <div className="text-center whitespace-nowrap">
        <span className={`text-xs font-mono tabular ${row.recusados > 0 ? "text-destructive" : "text-muted-foreground/60"}`}>
          {row.recusados > 0 ? row.recusados.toLocaleString("pt-BR") : "—"}
        </span>
      </div>
      <AccountCell name={row.account_name} dim={dimAccount} />
    </>
  );
}

// Estilos por nível — accent na borda esquerda + cor do label
const LEVELS = {
  campaign: {
    bar: "bg-primary",
    bg: "hover:bg-primary/[0.04]",
    label: "Campanha",
    labelColor: "text-primary border-primary/30 bg-primary/10",
  },
  adset: {
    bar: "bg-[hsl(var(--accent-cyan))]",
    bg: "hover:bg-[hsl(var(--accent-cyan)/0.04)]",
    label: "Conjunto",
    labelColor: "text-[hsl(var(--accent-cyan))] border-[hsl(var(--accent-cyan)/0.3)] bg-[hsl(var(--accent-cyan)/0.1)]",
  },
  ad: {
    bar: "bg-muted-foreground/40",
    bg: "hover:bg-accent/30",
    label: "Anúncio",
    labelColor: "text-muted-foreground border-border bg-muted/30",
  },
} as const;

// Toggle ativar/desativar (status ACTIVE ↔ PAUSED no Meta) — serve campanha,
// conjunto e anúncio (a API aceita o POST em qualquer nível pelo id). Verde =
// ativa, cinza = pausada; clicar alterna. stopPropagation pra não expandir a
// linha. Só aparece pra status alternável (ACTIVE/PAUSED); ARCHIVED/outros
// viram um selo estático. Erro (ex: sem permissão) vai num alert pra ser lido.
function StatusToggle({
  status,
  metaId,
  accountId,
  kindLabel = "campanha",
}: {
  status: string;
  metaId: string;
  accountId: string;
  kindLabel?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const alternavel = status === "ACTIVE" || status === "PAUSED";
  if (!alternavel) {
    return (
      <span className="shrink-0 text-[9px] font-mono uppercase tracking-wide text-muted-foreground/60" title={`Status no Meta: ${status}`}>
        {status.toLowerCase()}
      </span>
    );
  }
  const isActive = status === "ACTIVE";

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    const novo = isActive ? "PAUSED" : "ACTIVE";
    try {
      const res = await fetch("/api/campaigns/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, metaId, status: novo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoading(false);
        window.alert(json.error ?? "Falha ao alterar o status.");
        return;
      }
      setLoading(false);
      router.refresh();
    } catch (err) {
      setLoading(false);
      window.alert(err instanceof Error ? err.message : "Erro desconhecido");
    }
  }

  return (
    <span
      className="shrink-0 inline-flex items-center gap-1"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Switch estilo FB: trilho colorido quando ativa, knob desliza. */}
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={isActive ? `Pausar ${kindLabel}` : `Ativar ${kindLabel}`}
        onClick={toggle}
        disabled={loading}
        title={isActive ? `Pausar ${kindLabel}` : `Ativar ${kindLabel}`}
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          isActive ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            isActive ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </span>
  );
}

type Level = "campaigns" | "adsets" | "ads";

// Linha plana de um nível (campanha/conjunto/anúncio) — modelo FB por abas.
// Clicar no NOME desce um nível (drill-down), exceto no anúncio (último). O
// switch de status, o orçamento e as métricas são reuso puro do que já existia.
function LevelRow({
  node,
  level,
  checked,
  onToggleChecked,
  onDrill,
}: {
  node: CampaignNode;
  level: Level;
  checked: boolean;
  onToggleChecked: (id: string) => void;
  onDrill?: () => void;   // desce um nível; undefined no nível de anúncio
}) {
  const gridStyle = useGridStyle();
  const bar = level === "campaigns" ? LEVELS.campaign.bar : level === "adsets" ? LEVELS.adset.bar : LEVELS.ad.bar;
  const budgetLevel = level === "campaigns" ? "campaign" : level === "adsets" ? "adset" : undefined;
  const kindLabel = level === "campaigns" ? "campanha" : level === "adsets" ? "conjunto" : "anúncio";
  const drillTo = level === "campaigns" ? "conjuntos" : "anúncios";
  return (
    <div
      className={`relative grid gap-2 px-3 py-2.5 border-b border-border/30 hover:bg-accent/20 items-center transition-colors ${checked ? "bg-primary/[0.05]" : ""}`}
      style={gridStyle}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${bar}`} />
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleChecked(node.id)}
          title="Selecionar"
          className="shrink-0 h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
        />
        {node.status && node.accountId && (
          <StatusToggle status={node.status} metaId={node.id} accountId={node.accountId} kindLabel={kindLabel} />
        )}
        {onDrill ? (
          <button
            type="button"
            onClick={onDrill}
            title={`Ver ${drillTo} de ${node.name}`}
            className="min-w-0 truncate text-left text-[13px] font-medium hover:text-primary hover:underline transition-colors"
          >
            {node.name}
          </button>
        ) : (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={node.name}>{node.name}</span>
        )}
        {level === "ads" && (node.creative_link || node.source_url) && (
          <a
            href={(node.creative_link || node.source_url) as string}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver criativo"
            className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-primary hover:bg-primary/10 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <MetricsRow row={node} budgetLevel={budgetLevel} />
    </div>
  );
}

// Checkbox mestre do cabeçalho — marca/desmarca todas, indeterminate quando
// só parte das campanhas está selecionada (mesmo comportamento do FB Ads).
function MasterCheckbox({
  total,
  checkedCount,
  onToggle,
}: {
  total: number;
  checkedCount: number;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checkedCount > 0 && checkedCount < total;
  }, [checkedCount, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={total > 0 && checkedCount === total}
      onChange={onToggle}
      title={checkedCount === total ? "Desmarcar todas" : "Selecionar todas"}
      className="shrink-0 h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
    />
  );
}

const TABS: { key: Level; label: string }[] = [
  { key: "campaigns", label: "Campanhas" },
  { key: "adsets", label: "Conjuntos" },
  { key: "ads", label: "Anúncios" },
];

export function CampaignTree({ campaigns, initialCreative, initialCreativeId, clearCreativeHref }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Level>("campaigns");
  // Filtro por criativo — vem do deep-link do Ranking de criativos. Por
  // creative_id (preciso: distingue criativos de mesmo nome) ou, no fallback,
  // por nome. Escopa TODOS os níveis; aviso removível; persiste ao trocar de aba.
  const [creativeFilter, setCreativeFilter] = useState<string | null>(initialCreative?.trim() || null);
  const [creativeIdFilter, setCreativeIdFilter] = useState<string | null>(initialCreativeId?.trim() || null);
  // Drill-down: ids do nível PAI que filtram o nível atual (vazio = todos).
  const [campaignDrill, setCampaignDrill] = useState<string[]>([]);
  const [adsetDrill, setAdsetDrill] = useState<string[]>([]);
  // Seleção (checkbox) por nível — a do nível pai alimenta o drill.
  const [checkedByLevel, setCheckedByLevel] = useState<Record<Level, string[]>>({ campaigns: [], adsets: [], ads: [] });
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<MatchMode>("phrase");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  // "Ver só selecionadas" — filtra o nível atual pros itens marcados (checkbox).
  const [viewSelected, setViewSelected] = useState(false);
  const { widths, startResize, resetColumn, resetAll, isCustom } = useColumnWidths();

  // A URL é a fonte da verdade do filtro por criativo: quando ela muda (ex.:
  // trocar período/conta limpa o ?creative, ou "ver tudo" o remove), o estado
  // acompanha. Sem isso o filtro ficava "grudado" mesmo com a URL já limpa.
  useEffect(() => {
    setCreativeFilter(initialCreative?.trim() || null);
    setCreativeIdFilter(initialCreativeId?.trim() || null);
  }, [initialCreative, initialCreativeId]);

  // Nome por id (pro chip de drill-down) + achatamento dos níveis. Os conjuntos
  // carregam o campaignId e os anúncios o adsetId, pra filtrar no drill-down.
  const campNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name);
    return m;
  }, [campaigns]);
  const adsetNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) for (const a of c.adsets) m.set(a.id, a.name);
    return m;
  }, [campaigns]);
  const allAdsets = useMemo(
    () => campaigns.flatMap(c => c.adsets.map(a => ({ node: a as CampaignNode, campaignId: c.id }))),
    [campaigns],
  );
  const allAds = useMemo(
    () => campaigns.flatMap(c => c.adsets.flatMap(a => a.ads.map(ad => ({ node: ad, adsetId: a.id, campaignId: c.id })))),
    [campaigns],
  );

  // Campanhas/conjuntos que contêm um anúncio do criativo filtrado (match por
  // nome normalizado, igual ao ranking). null quando não há filtro de criativo.
  const creativeNorm = creativeFilter ? creativeKey(creativeFilter) : null;
  const hasCreativeFilter = !!(creativeIdFilter || creativeNorm);
  // Match do anúncio ao criativo: por creative_id (preciso) ou, sem ele, por
  // nome normalizado. Deriva também o rótulo do banner (nome do 1º match) —
  // útil quando o deep-link veio só com o id.
  const creativeMatch = useMemo(() => {
    if (!creativeIdFilter && !creativeNorm) return null;
    const campaignIds = new Set<string>();
    const adsetIds = new Set<string>();
    let label: string | null = creativeFilter;
    for (const c of campaigns) {
      for (const a of c.adsets) {
        for (const ad of a.ads) {
          const hit = creativeIdFilter
            ? ad.creative_id === creativeIdFilter
            : creativeKey(ad.name) === creativeNorm;
          if (hit) {
            campaignIds.add(c.id); adsetIds.add(a.id);
            if (!label && ad.name) label = ad.name;
          }
        }
      }
    }
    return { campaignIds, adsetIds, label };
  }, [campaigns, creativeIdFilter, creativeNorm, creativeFilter]);
  const creativeLabel = creativeMatch?.label ?? creativeFilter ?? "criativo";
  // "Ver tudo": limpa o filtro por criativo (estado) E o ?creative/?creativeId
  // da URL, pra ele não reaparecer num reload / troca de período.
  const clearCreativeFilter = () => {
    setCreativeFilter(null);
    setCreativeIdFilter(null);
    if (clearCreativeHref) router.replace(clearCreativeHref);
  };

  const checked = checkedByLevel[tab];
  const setCheckedForTab = (updater: (prev: string[]) => string[]) =>
    setCheckedByLevel(prev => ({ ...prev, [tab]: updater(prev[tab]) }));

  // Lista base do nível atual (com o drill-down do pai aplicado). Nos anúncios o
  // escopo por conjunto tem precedência; sem ele, cai no escopo por campanha
  // (marcar campanhas → aba Anúncios mostra os anúncios daquelas campanhas).
  const baseList: CampaignNode[] = useMemo(() => {
    if (tab === "campaigns") {
      return creativeMatch ? campaigns.filter(c => creativeMatch.campaignIds.has(c.id)) : campaigns;
    }
    if (tab === "adsets") {
      return allAdsets
        .filter(a => campaignDrill.length === 0 || campaignDrill.includes(a.campaignId))
        .filter(a => !creativeMatch || creativeMatch.adsetIds.has(a.node.id))
        .map(a => a.node);
    }
    return allAds
      .filter(a =>
        adsetDrill.length > 0
          ? adsetDrill.includes(a.adsetId)
          : campaignDrill.length === 0 || campaignDrill.includes(a.campaignId),
      )
      .filter(a =>
        !hasCreativeFilter ||
        (creativeIdFilter ? a.node.creative_id === creativeIdFilter : creativeKey(a.node.name) === creativeNorm),
      )
      .map(a => a.node);
  }, [tab, campaigns, allAdsets, allAds, campaignDrill, adsetDrill, creativeMatch, hasCreativeFilter, creativeIdFilter, creativeNorm]);

  // Aplica filtros de nome + status + ordenação sobre o nível atual.
  const rows = useMemo(() => {
    let list = baseList;
    if (viewSelected && checked.length > 0) list = list.filter(n => checked.includes(n.id));
    const matchName = makeNameFilter(query, mode);
    if (matchName) list = list.filter(n => matchName(n.name));
    if (statusFilter !== "all") list = list.filter(n => matchStatus(n.status, statusFilter));
    if (sort) list = [...list].sort(makeComparator(sort));
    return list;
  }, [baseList, viewSelected, checked, query, mode, statusFilter, sort]);

  const isFiltering = rows.length !== baseList.length;
  const rowIds = useMemo(() => rows.map(r => r.id), [rows]);

  // Paginação (client-side) — a lista pode ser longa (agora traz TODAS as
  // campanhas ativas, mesmo sem gasto). Volta pra 1ª página quando o conjunto
  // filtrado muda (nível, busca, filtro, ordenação).
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [statusFilter, tab, query, mode, viewSelected, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [rows, safePage],
  );
  const checkedInView = checked.filter(id => rowIds.indexOf(id) !== -1).length;

  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: widths.map(w => `${w}px`).join(" ") }),
    [widths],
  );
  const minWidth = useMemo(
    () => widths.reduce((a, b) => a + b, 0) + (COLUMNS.length - 1) * GAP_PX + ROW_PAD_PX,
    [widths],
  );

  const toggleChecked = (id: string) =>
    setCheckedForTab(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setCheckedForTab(prev => {
      const all = rowIds.length > 0 && rowIds.every(id => prev.indexOf(id) !== -1);
      return all
        ? prev.filter(id => rowIds.indexOf(id) === -1)
        : prev.concat(rowIds.filter(id => prev.indexOf(id) === -1));
    });

  const clearSelection = () => { setViewSelected(false); setCheckedForTab(() => []); };

  const toggleSort = (key: SortKey) =>
    setSort(prev =>
      prev?.key !== key ? { key, dir: "desc" } :
      prev.dir === "desc" ? { key, dir: "asc" } :
      null,
    );

  // ── Navegação / drill-down ────────────────────────────────────────────────
  const drillInto = (child: "adsets" | "ads", parentIds: string[]) => {
    if (child === "adsets") setCampaignDrill(parentIds);
    else setAdsetDrill(parentIds);
    setViewSelected(false);
    setTab(child);
  };
  // Trocar de aba pelo topo: se há itens marcados no nível pai, usa como drill;
  // senão mostra tudo. Nos anúncios, conjuntos marcados têm precedência; sem
  // eles, cai no escopo por campanha marcada.
  const switchTab = (t: Level) => {
    if (t === "adsets") setCampaignDrill(checkedByLevel.campaigns);
    if (t === "ads") {
      if (checkedByLevel.adsets.length > 0) {
        setAdsetDrill(checkedByLevel.adsets);
      } else {
        setAdsetDrill([]);
        setCampaignDrill(checkedByLevel.campaigns);
      }
    }
    setViewSelected(false);
    setTab(t);
  };

  // Chip do drill-down atual. Nos anúncios o rótulo reflete o escopo efetivo:
  // por conjunto (se houver) ou, na falta, por campanha.
  const adsByAdset = tab === "ads" && adsetDrill.length > 0;
  const drill = tab === "adsets" ? campaignDrill : tab === "ads" ? (adsetDrill.length > 0 ? adsetDrill : campaignDrill) : [];
  const drillNameMap = tab === "adsets" || !adsByAdset ? campNameById : adsetNameById;
  const drillChildNoun = tab === "adsets" || !adsByAdset ? "campanhas" : "conjuntos";
  const drillNames = drill.map(id => drillNameMap.get(id)).filter(Boolean) as string[];
  const drillLabel = drillNames.length === 1 ? drillNames[0] : `${drillNames.length} ${drillChildNoun}`;
  const clearDrill = () => {
    if (tab === "adsets") setCampaignDrill([]);
    else { setAdsetDrill([]); setCampaignDrill([]); }
  };

  const levelNoun = tab === "campaigns" ? "campanha" : tab === "adsets" ? "conjunto" : "anúncio";
  const childNoun = tab === "campaigns" ? "conjuntos" : "anúncios";

  // Totais do nível atual (soma das linhas visíveis daquele nível).
  const totals = useMemo(() => {
    const t = { spend: 0, leads: 0, purchases: 0, boletos: 0, pixGerados: 0, recusados: 0, agendamentos: 0, agendamentosValue: 0, revenue: 0, lucro: 0 };
    for (const c of rows) {
      t.spend += c.spend; t.leads += c.leads; t.purchases += c.purchases;
      t.boletos += c.boletos; t.pixGerados += c.pixGerados; t.recusados += c.recusados;
      t.agendamentos += c.agendamentos; t.agendamentosValue += c.agendamentosValue;
      t.revenue += c.revenue; t.lucro += c.lucro;
    }
    return t;
  }, [rows]);

  const head = { onResizeStart: startResize, onResetCol: resetColumn };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-center lg:justify-between">
        {/* Abas de nível — Campanhas / Conjuntos / Anúncios (estilo FB). */}
        <div className="flex items-center gap-1 shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={`h-8 px-3 rounded-md text-[13px] transition-colors ${
                tab === t.key
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              {t.label}
            </button>
          ))}
          {isFiltering && (
            <span className="ml-1 text-[11px] font-normal font-mono text-muted-foreground">
              {rows.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro por status — Todas / Ativas / Pausadas. */}
          <div className="inline-flex h-8 items-center rounded-md border border-border overflow-hidden">
            {(["all", "active", "paused"] as StatusFilter[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`h-full px-2.5 text-[11px] transition-colors ${
                  statusFilter === f
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                {STATUS_LABELS[f]}
              </button>
            ))}
          </div>
          <NameFilter query={query} mode={mode} onQuery={setQuery} onMode={setMode} />
          {isCustom && (
            <button
              type="button"
              onClick={resetAll}
              title="Restaurar largura padrão das colunas"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
            >
              Colunas
              <X className="h-3 w-3" />
            </button>
          )}
          {sort && (
            <button
              type="button"
              onClick={() => setSort(null)}
              title="Remover ordenação"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
            >
              {SORT_LABELS[sort.key]} {sort.dir === "desc" ? "maior→menor" : "menor→maior"}
              <X className="h-3 w-3" />
            </button>
          )}
          {checked.length > 0 && (
            <>
              {/* Ver só as marcadas — filtra o nível atual pros itens do checkbox. */}
              <button
                type="button"
                onClick={() => setViewSelected(v => !v)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-colors ${
                  viewSelected
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                {viewSelected
                  ? `Mostrando ${checked.length} ${tab === "campaigns" ? "selecionadas" : "selecionados"}`
                  : `Ver só ${tab === "campaigns" ? "selecionadas" : "selecionados"} (${checked.length})`}
              </button>
              {tab !== "ads" && (
                <button
                  type="button"
                  onClick={() => drillInto(tab === "campaigns" ? "adsets" : "ads", checked)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-primary/40 bg-primary/10 text-xs text-primary hover:bg-primary/15 transition-colors"
                >
                  Ver {childNoun} ({checked.length})
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={clearSelection}
                title="Limpar seleção"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {/* Aviso do filtro por criativo (deep-link do Ranking de criativos). */}
        {hasCreativeFilter && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-primary/20 bg-primary/[0.06]">
            <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-xs text-muted-foreground">Criativo:</span>
            <span className="text-xs font-medium text-primary truncate max-w-[280px]" title={creativeLabel}>{creativeLabel}</span>
            <button
              type="button"
              onClick={clearCreativeFilter}
              title="Remover filtro de criativo"
              className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> ver tudo
            </button>
          </div>
        )}
        {/* Chip do drill-down — mostra o filtro herdado do nível pai. */}
        {drill.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {tab === "adsets" ? "Conjuntos de" : "Anúncios de"}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary text-xs px-2 py-0.5"
              title={drillNames.join(", ")}
            >
              {drillLabel}
              <button
                type="button"
                onClick={clearDrill}
                title="Remover filtro"
                className="hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            <button
              type="button"
              onClick={clearDrill}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ver todos os {levelNoun}s
            </button>
          </div>
        )}
        <GridStyleCtx.Provider value={gridStyle}>
          <div style={{ minWidth }}>
            <div
              className="grid gap-2 px-3 py-3 border-b border-border/60 bg-muted/30 items-center sticky top-0 z-10"
              style={gridStyle}
            >
              <HeadShell index={0} {...head}>
                <div className="flex items-center gap-2">
                  <MasterCheckbox
                    total={rows.length}
                    checkedCount={checkedInView}
                    onToggle={toggleAll}
                  />
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {levelNoun}s
                  </span>
                </div>
              </HeadShell>
              <HeadShell index={1} {...head}>
                <span className="block text-center text-[11px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                  Orçamento
                </span>
              </HeadShell>
              <HeadShell index={2} {...head}>
                <span className="block text-center text-[11px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                  Lance
                </span>
              </HeadShell>
              <HeadShell index={3} {...head}>
                <HeadCell parts={[{ key: "spend", label: "Gasto" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={4} {...head}>
                <HeadCell parts={[{ key: "purchases", label: "Vendas" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={5} {...head}>
                <HeadCell parts={[{ key: "cpa", label: "CPA" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={6} {...head}>
                <HeadCell parts={[{ key: "revenue", label: "Faturamento" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={7} {...head}>
                <HeadCell parts={[{ key: "lucro", label: "Lucro" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={8} {...head}>
                <HeadCell parts={[{ key: "roas", label: "ROAS" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={9} {...head}>
                <HeadCell parts={[{ key: "agendamentos", label: "Agendamento" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={10} {...head}>
                <HeadCell parts={[{ key: "roasAgendamento", label: "ROAS Agend." }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={11} {...head}>
                <HeadCell parts={[{ key: "cpaAgendamento", label: "CPA Agend." }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={12} {...head}>
                <HeadCell parts={[{ key: "leads", label: "Leads" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={13} {...head}>
                <HeadCell parts={[{ key: "cpl", label: "CPL" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={14} {...head}>
                <HeadCell parts={[{ key: "boletos", label: "Boletos" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={15} {...head}>
                <HeadCell parts={[{ key: "pixGerados", label: "PIX Ger" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={16} {...head}>
                <HeadCell parts={[{ key: "recusados", label: "Recusados" }]} sort={sort} onSort={toggleSort} />
              </HeadShell>
              <HeadShell index={17} {...head} last>
                <span className="block text-[11px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                  Conta
                </span>
              </HeadShell>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                {baseList.length === 0
                  ? (hasCreativeFilter
                      ? `Nenhum ${levelNoun} com esse criativo no período.`
                      : `Nenhum ${levelNoun} ${drill.length > 0 ? "aqui" : "no período"}.`)
                  : <>
                      Nenhum {levelNoun} com esse filtro.
                      <button
                        type="button"
                        onClick={() => { setQuery(""); setStatusFilter("all"); }}
                        className="ml-1.5 underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        Limpar filtros
                      </button>
                    </>}
              </div>
            ) : pagedRows.map(r => (
              <LevelRow
                key={r.id}
                node={r}
                level={tab}
                checked={checked.includes(r.id)}
                onToggleChecked={toggleChecked}
                onDrill={tab === "ads" ? undefined : () => drillInto(tab === "campaigns" ? "adsets" : "ads", [r.id])}
              />
            ))}
            {rows.length > 0 && <TotalsRow totals={totals} count={rows.length} noun={levelNoun} />}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 pt-3 text-xs">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="h-8 px-3 rounded-md border border-border text-muted-foreground hover:bg-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Anterior
              </button>
              <span className="font-mono text-muted-foreground">
                Página {safePage + 1} de {pageCount}
                <span className="text-muted-foreground/60"> · {rows.length} {levelNoun}{rows.length > 1 ? "s" : ""}</span>
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                className="h-8 px-3 rounded-md border border-border text-muted-foreground hover:bg-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima ›
              </button>
            </div>
          )}
        </GridStyleCtx.Provider>
      </CardContent>
    </Card>
  );
}

// Linha de totais no rodapé — soma das campanhas visíveis, alinhada às colunas.
// Razões (CPL/CPA/ROAS) recalculadas do agregado, não média das médias. Usa o
// mesmo template de grid das linhas (via contexto) pra alinhar com o cabeçalho.
type Totals = {
  spend: number; leads: number; purchases: number;
  boletos: number; pixGerados: number; recusados: number; agendamentos: number;
  agendamentosValue: number;
  revenue: number; lucro: number;
};

function TotalCell({ value, sub, tone }: { value: string; sub?: string; tone?: string }) {
  return (
    <div className="text-center whitespace-nowrap">
      <span className={`text-xs font-mono tabular font-semibold ${tone ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="block text-[10px] font-mono text-muted-foreground/70 mt-0.5">{sub}</span>}
    </div>
  );
}

function TotalsRow({ totals, count, noun = "campanha" }: { totals: Totals; count: number; noun?: string }) {
  const gridStyle = useGridStyle();
  const cpl  = totals.leads > 0     ? totals.spend / totals.leads     : 0;
  const cpa  = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const roas = totals.spend > 0     ? totals.revenue / totals.spend   : 0;
  const cpaAgend = totals.agendamentos > 0 ? totals.spend / totals.agendamentos : 0;
  const roasAgend = totals.spend > 0 ? totals.agendamentosValue / totals.spend : 0;
  const lucroColor =
    totals.lucro > 0 ? "text-primary" :
    totals.lucro < 0 ? "text-destructive" :
                       "text-muted-foreground";
  const roasColor =
    roas >= 1 ? "text-[hsl(var(--accent-cyan))]" :
    roas > 0  ? "text-muted-foreground" :
                "text-muted-foreground/60";
  return (
    <div
      className="grid gap-2 px-3 py-3 border-t-2 border-border/70 bg-muted/40 items-center"
      style={gridStyle}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">Total</span>
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          {count} {noun}{count > 1 ? "s" : ""}
        </span>
      </div>
      {/* Orçamento não soma no rodapé: mistura diário/vitalício e moedas. */}
      <div className="text-center"><span className="text-xs font-mono text-muted-foreground/40">—</span></div>
      {/* Lance também não soma. */}
      <div className="text-center"><span className="text-xs font-mono text-muted-foreground/40">—</span></div>
      <TotalCell value={totals.spend > 0 ? formatCurrency(totals.spend) : "—"} />
      <TotalCell value={totals.purchases > 0 ? totals.purchases.toLocaleString("pt-BR") : "—"} />
      <TotalCell value={cpa > 0 ? formatCurrency(cpa) : "—"} />
      <TotalCell value={totals.revenue > 0 ? formatCurrency(totals.revenue) : "—"} />
      <TotalCell value={totals.lucro !== 0 ? formatCurrency(totals.lucro) : "—"} tone={lucroColor} />
      <TotalCell value={roas > 0 ? `${roas.toFixed(2)}×` : "—"} tone={roasColor} />
      <TotalCell
        value={totals.agendamentos > 0 ? totals.agendamentos.toLocaleString("pt-BR") : "—"}
        tone={totals.agendamentos > 0 ? "text-[hsl(var(--accent-amber))]" : "text-muted-foreground/60"}
      />
      <TotalCell
        value={roasAgend > 0 ? `${roasAgend.toFixed(2)}×` : "—"}
        tone={roasAgend >= 1 ? "text-[hsl(var(--accent-amber))]" : roasAgend > 0 ? "text-muted-foreground" : "text-muted-foreground/60"}
      />
      <TotalCell value={cpaAgend > 0 ? formatCurrency(cpaAgend) : "—"} />
      <TotalCell value={totals.leads > 0 ? totals.leads.toLocaleString("pt-BR") : "—"} />
      <TotalCell value={cpl > 0 ? formatCurrency(cpl) : "—"} />
      <TotalCell value={totals.boletos > 0 ? totals.boletos.toLocaleString("pt-BR") : "—"} />
      <TotalCell value={totals.pixGerados > 0 ? totals.pixGerados.toLocaleString("pt-BR") : "—"} />
      <TotalCell
        value={totals.recusados > 0 ? totals.recusados.toLocaleString("pt-BR") : "—"}
        tone={totals.recusados > 0 ? "text-destructive" : "text-muted-foreground/60"}
      />
      <div />
    </div>
  );
}

// Caixa de busca + seletor de modo. Estilo alinhado ao SearchInput das telas de
// Leads/Vendas, mas sem query param: filtra em memória enquanto digita. O
// seletor de modo só aparece com termo digitado — sem termo ele não faz nada.
function NameFilter({
  query,
  mode,
  onQuery,
  onMode,
}: {
  query: string;
  mode: MatchMode;
  onQuery: (v: string) => void;
  onMode: (m: MatchMode) => void;
}) {
  const modes: MatchMode[] = ["phrase", "any"];
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex items-center group/search">
        <Search
          className="absolute left-2.5 h-3 w-3 text-muted-foreground/60 pointer-events-none transition-colors group-focus-within/search:text-foreground"
          strokeWidth={2}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filtrar por nome…"
          aria-label="Filtrar campanhas por nome"
          className="h-8 pl-7 pr-7 w-full sm:w-56 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Limpar filtro"
            className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {query.trim() && (
        <div className="inline-flex h-8 items-center rounded-md border border-border overflow-hidden">
          {modes.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              title={MATCH_LABELS[m].hint}
              className={`h-full px-2.5 text-[11px] transition-colors ${
                mode === m
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              {MATCH_LABELS[m].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Envelope da célula de cabeçalho: posiciona a alça de redimensionamento na
// borda direita. A alça fica dentro do gap (gap-2 = 8px) pra não deslocar o
// conteúdo; na última coluna encosta na borda, senão sairia da área rolável.
function HeadShell({
  index,
  children,
  onResizeStart,
  onResetCol,
  last,
}: {
  index: number;
  children: React.ReactNode;
  onResizeStart: (index: number, clientX: number) => void;
  onResetCol: (index: number) => void;
  last?: boolean;
}) {
  return (
    <div className="relative min-w-0">
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        title="Arraste pra ajustar a largura · clique duplo pra restaurar"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(index, e.clientX);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onResetCol(index);
        }}
        className={`group absolute top-1/2 -translate-y-1/2 z-20 flex h-6 w-[14px] cursor-col-resize items-center justify-center touch-none ${
          last ? "right-0" : "-right-[11px]"
        }`}
      >
        <span className="h-4 w-px bg-border transition-all group-hover:h-5 group-hover:w-0.5 group-hover:bg-primary" />
      </span>
    </div>
  );
}

function HeadCell({
  parts,
  sort,
  onSort,
}: {
  parts: { key: SortKey; label: string }[];
  sort: SortState | null;
  onSort: (key: SortKey) => void;
}) {
  return (
    <span className="flex items-center justify-center gap-1 text-[11px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
      {parts.map((p, i) => {
        const active = sort?.key === p.key;
        return (
          <span key={p.key} className="inline-flex items-center gap-0.5">
            {i > 0 && <span className="mr-1">·</span>}
            <button
              type="button"
              onClick={() => onSort(p.key)}
              title={`Ordenar por ${SORT_LABELS[p.key]}`}
              className={`inline-flex items-center gap-0.5 uppercase tracking-[0.08em] transition-colors hover:text-foreground ${
                active ? "text-primary" : ""
              }`}
            >
              {p.label}
              {active && (sort!.dir === "desc"
                ? <ArrowDown className="h-2.5 w-2.5" />
                : <ArrowUp className="h-2.5 w-2.5" />)}
            </button>
          </span>
        );
      })}
    </span>
  );
}
