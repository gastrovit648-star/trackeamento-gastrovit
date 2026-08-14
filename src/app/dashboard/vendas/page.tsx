export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import { getDateRange, getPurchasesList, getDistinctAffiliates, getRecordContext, getSalesByLocation } from "@/lib/queries";
import { resolveProjectScope } from "@/lib/projects";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/metric-card";
import { formatCurrency, formatDateSP } from "@/lib/utils";
import { DollarSign, ExternalLink, ShoppingCart } from "lucide-react";
import { RecordDetailsDrawer } from "@/components/record-details-drawer";
import { SearchInput } from "@/components/search-input";
import { ClickableRow } from "@/components/clickable-row";
import { DeletePurchaseButton } from "@/components/delete-purchase-button";
import { BrazilMap } from "@/components/brazil-map";
import { TopCities } from "@/components/top-cities";

function formatPhoneBR(p: string | null | undefined): string {
  if (!p) return "—";
  if (p.length === 13 && p.startsWith("55")) {
    return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`;
  }
  return p;
}

function statusBadge(s: string) {
  if (s === "approved") return <Badge>Aprovada</Badge>;
  if (s === "refunded") return <Badge variant="destructive">Reembolsada</Badge>;
  if (s === "pending")  return <Badge variant="secondary">Pendente</Badge>;
  if (s === "refused")  return <Badge variant="destructive">Recusada</Badge>;
  if (s === "scheduled") return <Badge variant="outline" className="border-[hsl(var(--accent-amber)/0.5)] text-[hsl(var(--accent-amber))]">Agendamento</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; status?: string; affiliate?: string; source?: string; page?: string; selected?: string; q?: string; project?: string };
}) {
  const { from, to } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const { projectId, projectAccountIds } = await resolveProjectScope(supabase, searchParams.project);
  const status = (searchParams.status === "approved" || searchParams.status === "refunded" || searchParams.status === "pending" || searchParams.status === "refused" || searchParams.status === "scheduled")
    ? searchParams.status : null;
  // affiliate=producer é sentinela pra "vendas sem afiliado" (do produtor).
  // E-mails reais sempre contêm '@', então não há colisão.
  const producerOnly = searchParams.affiliate === "producer";
  const affiliate = producerOnly ? null : (searchParams.affiliate || null);
  const source = (searchParams.source === "payt" || searchParams.source === "manual" || searchParams.source === "luminar-pay" || searchParams.source === "skale")
    ? searchParams.source : null;
  const search = searchParams.q || null;
  const page = searchParams.page ? Math.max(0, parseInt(searchParams.page) - 1) : 0;
  const pageSize = 50;
  const selectedId = searchParams.selected || null;

  const attendantsQuery = supabase.from("attendants").select("email").eq("is_active", true);
  const [{ rows, total }, { rows: allRows }, affiliates, details, locations, attendantRows] = await Promise.all([
    getPurchasesList(supabase, from, to, {
      status, projectAccountIds, affiliateEmail: affiliate, producerOnly, source, search, page, pageSize,
    }),
    // Métricas top — sempre puxa tudo (sem filter por status/search) pra cards agregados.
    getPurchasesList(supabase, from, to, { projectAccountIds, affiliateEmail: affiliate, producerOnly, source, page: 0, pageSize: 1000 }),
    getDistinctAffiliates(supabase, from, to, projectAccountIds),
    selectedId ? getRecordContext(supabase, "purchase", selectedId) : Promise.resolve(null),
    getSalesByLocation(supabase, from, to, { affiliateEmail: affiliate, producerOnly, projectAccountIds }),
    projectId ? attendantsQuery.contains("project_ids", [projectId]) : attendantsQuery,
  ]);
  const registeredEmails = new Set(
    ((attendantRows.data ?? []) as Array<{ email: string }>).map(a => a.email.toLowerCase()),
  );
  type R = { value: number; commission_value: number | null; status: string };
  const all = allRows as unknown as R[];
  const approved = all.filter(r => r.status === "approved");
  const revenue = approved.reduce((s, r) => s + Number(r.commission_value ?? r.value), 0);
  const ticketMedio = approved.length > 0 ? revenue / approved.length : 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      {details && (
        <RecordDetailsDrawer data={details} />
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Vendas aprovadas" value={approved.length.toLocaleString("pt-BR")} icon={ShoppingCart} delay={0} />
        <MetricCard title="Faturamento aprovado" value={formatCurrency(revenue)} icon={DollarSign} delay={1} />
        <MetricCard title="Ticket médio" value={ticketMedio > 0 ? formatCurrency(ticketMedio) : "—"} icon={DollarSign} delay={2} />
      </div>

      {/* Filtro de origem — Payt / Luminar-pay (gateways) vs Manual (lançamento interno) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0">
          Origem
        </span>
        <a
          href={mkHref(searchParams, 0, { drop: "source" })}
          className={`px-3 py-1 rounded border text-xs ${!source ? "bg-accent" : "hover:bg-accent"}`}
        >
          Todas
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { source: "payt" } })}
          className={`px-3 py-1 rounded border text-xs ${source === "payt" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Payt
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { source: "luminar-pay" } })}
          className={`px-3 py-1 rounded border text-xs ${source === "luminar-pay" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Luminar-pay
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { source: "skale" } })}
          className={`px-3 py-1 rounded border text-xs ${source === "skale" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Skale
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { source: "manual" } })}
          className={`px-3 py-1 rounded border text-xs ${source === "manual" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Manual
        </a>
      </div>

      {/* Filtro de status — mesma mecânica do filtro de origem (?status= já
          era aceito pela página; aqui só a UI) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0">
          Status
        </span>
        <a
          href={mkHref(searchParams, 0, { drop: "status" })}
          className={`px-3 py-1 rounded border text-xs ${!status ? "bg-accent" : "hover:bg-accent"}`}
        >
          Todos
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { status: "approved" } })}
          className={`px-3 py-1 rounded border text-xs ${status === "approved" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Aprovada
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { status: "pending" } })}
          className={`px-3 py-1 rounded border text-xs ${status === "pending" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Pendente
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { status: "refunded" } })}
          className={`px-3 py-1 rounded border text-xs ${status === "refunded" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Reembolsada
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { status: "refused" } })}
          className={`px-3 py-1 rounded border text-xs ${status === "refused" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Recusada
        </a>
        <a
          href={mkHref(searchParams, 0, { set: { status: "scheduled" } })}
          className={`px-3 py-1 rounded border text-xs ${status === "scheduled" ? "bg-accent" : "hover:bg-accent"}`}
        >
          Agendamento
        </a>
      </div>

      {/* Filtro de afiliado — linha própria acima da tabela */}
      {affiliates.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0">
            Afiliado
          </span>
          <a
            href={mkHref(searchParams, 0, { drop: "affiliate" })}
            className={`px-3 py-1 rounded border text-xs ${!affiliate && !producerOnly ? "bg-accent" : "hover:bg-accent"}`}
          >
            Todos
          </a>
          <a
            href={mkHref(searchParams, 0, { set: { affiliate: "producer" } })}
            title="Vendas sem afiliado (do produtor)"
            className={`px-3 py-1 rounded border text-xs ${producerOnly ? "bg-accent" : "hover:bg-accent"}`}
          >
            Produtor
          </a>
          {affiliates.map(email => {
            const isExternal = !registeredEmails.has(email.toLowerCase());
            const isActive = affiliate === email;
            return (
              <a
                key={email}
                href={mkHref(searchParams, 0, { set: { affiliate: email } })}
                title={isExternal
                  ? `${email} (não cadastrado em Atendentes)`
                  : email}
                className={`px-3 py-1 rounded border font-mono text-[11px] inline-flex items-center gap-1.5 truncate max-w-[260px] transition-colors ${
                  isActive
                    ? "bg-accent"
                    : isExternal
                      ? "border-[hsl(var(--accent-amber)/0.4)] text-[hsl(var(--accent-amber))] hover:bg-[hsl(var(--accent-amber)/0.1)]"
                      : "hover:bg-accent"
                }`}
              >
                {isExternal && <span className="h-1 w-1 rounded-full bg-[hsl(var(--accent-amber))] shrink-0" aria-hidden />}
                <span className="truncate">{email}</span>
              </a>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <CardTitle>Vendas ({total})</CardTitle>
          <SearchInput placeholder="Buscar por telefone ou email…" />
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction ID</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Afiliado</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Conjunto</TableHead>
                <TableHead>Anúncio</TableHead>
                <TableHead>Criativo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right sr-only">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center text-muted-foreground py-8">
                    Nenhuma venda no período.
                  </TableCell>
                </TableRow>
              ) : rows.map(r => {
                const row = r as {
                  id: string;
                  transaction_id: string;
                  phone: string | null;
                  email: string | null;
                  product_name: string | null;
                  value: number;
                  commission_value: number | null;
                  currency: string;
                  status: string;
                  affiliate_email: string | null;
                  matched_lead: boolean;
                  source: "payt" | "manual" | "luminar-pay" | "skale" | null;
                  source_url: string | null;
                  campaign_id: string | null;
                  campaign_name: string | null;
                  adset_id: string | null;
                  adset_name: string | null;
                  ad_id: string | null;
                  ad_name: string | null;
                  meta_account_id: string | null;
                  meta_account_name: string | null;
                  created_at: string;
                };
                const value = Number(row.commission_value ?? row.value);
                const adsUrl = (level: "campaign" | "adset" | "ad", id: string) => {
                  const param = level === "campaign" ? "selected_campaign_ids" : level === "adset" ? "selected_adset_ids" : "selected_ad_ids";
                  return `https://www.facebook.com/adsmanager/manager/accounts/?act=${row.meta_account_id}&${param}=${id}`;
                };
                return (
                  <ClickableRow
                    key={row.id}
                    href={mkHref(searchParams, page, { set: { selected: row.id } })}
                  >
                    <TableCell className="font-mono text-[10px]">{row.transaction_id}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{formatPhoneBR(row.phone)}</TableCell>
                    <TableCell className="text-xs">{row.email || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{row.product_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{formatCurrency(value)}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>
                      {row.source === "manual"
                        ? <Badge variant="outline" className="border-[hsl(var(--accent-amber)/0.5)] text-[hsl(var(--accent-amber))]">Manual</Badge>
                        : row.source === "luminar-pay"
                          ? <Badge variant="outline" className="border-[hsl(var(--accent)/0.5)]">Luminar-pay</Badge>
                          : row.source === "skale"
                            ? <Badge variant="outline" className="border-[hsl(var(--accent-cyan)/0.5)] text-[hsl(var(--accent-cyan))]">Skale</Badge>
                            : <span className="text-muted-foreground text-xs">Payt</span>}
                    </TableCell>
                    <TableCell className="text-xs">{row.affiliate_email || <Badge variant="outline">Produtor</Badge>}</TableCell>
                    <TableCell>
                      {row.matched_lead
                        ? <Badge variant="outline">Match</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-xs max-w-[180px]">
                      {row.meta_account_name ? (
                        <div className="min-w-0">
                          <span
                            className="block truncate"
                            title={`${row.meta_account_name} (${row.meta_account_id})`}
                          >
                            {row.meta_account_name}
                          </span>
                          <span className="block text-[10px] font-mono text-muted-foreground truncate">
                            {row.meta_account_id}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-[220px]">
                      {row.campaign_name ? (
                        row.meta_account_id && row.campaign_id ? (
                          <a href={adsUrl("campaign", row.campaign_id)} target="_blank" rel="noopener noreferrer" title={row.campaign_name} className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-full">
                            <span className="truncate">{row.campaign_name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="truncate block" title={row.campaign_name}>{row.campaign_name}</span>
                        )
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      {row.adset_name ? (
                        row.meta_account_id && row.adset_id ? (
                          <a href={adsUrl("adset", row.adset_id)} target="_blank" rel="noopener noreferrer" title={row.adset_name} className="inline-flex items-center gap-1 text-[hsl(var(--accent-cyan))] hover:underline truncate max-w-full">
                            <span className="truncate">{row.adset_name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="truncate block" title={row.adset_name}>{row.adset_name}</span>
                        )
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      {row.ad_name ? (
                        row.meta_account_id && row.ad_id ? (
                          <a href={adsUrl("ad", row.ad_id)} target="_blank" rel="noopener noreferrer" title={row.ad_name} className="inline-flex items-center gap-1 text-foreground hover:text-primary hover:underline truncate max-w-full">
                            <span className="truncate">{row.ad_name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="truncate block" title={row.ad_name}>{row.ad_name}</span>
                        )
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.source_url ? (
                        <a
                          href={row.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Ver <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-mono">{formatDateSP(row.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <DeletePurchaseButton id={row.id} label={row.transaction_id} />
                    </TableCell>
                  </ClickableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Distribuição geográfica das vendas ──────────────────────────── */}
      {(locations.byState.length > 0 || locations.byCity.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Vendas por estado</CardTitle>
            </CardHeader>
            <CardContent>
              <BrazilMap data={locations.byState} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top cidades</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <TopCities rows={locations.byCity} />
            </CardContent>
          </Card>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">Página {page + 1} de {totalPages}</span>
          {page > 0 && (
            <a href={mkHref(searchParams, page - 1)} className="px-3 py-1 rounded border hover:bg-accent">Anterior</a>
          )}
          {page < totalPages - 1 && (
            <a href={mkHref(searchParams, page + 1)} className="px-3 py-1 rounded border hover:bg-accent">Próxima</a>
          )}
        </div>
      )}
    </div>
  );
}

function mkHref(
  searchParams: { from?: string; to?: string; status?: string; affiliate?: string; source?: string; page?: string; selected?: string; q?: string; project?: string },
  p: number,
  opts: { set?: Record<string, string>; drop?: string } = {},
) {
  const sp = new URLSearchParams();
  if (searchParams.from)      sp.set("from", searchParams.from);
  if (searchParams.to)        sp.set("to", searchParams.to);
  if (searchParams.project)   sp.set("project", searchParams.project);
  if (searchParams.status)    sp.set("status", searchParams.status);
  if (searchParams.affiliate) sp.set("affiliate", searchParams.affiliate);
  if (searchParams.source)    sp.set("source", searchParams.source);
  if (searchParams.selected)  sp.set("selected", searchParams.selected);
  if (searchParams.q)         sp.set("q", searchParams.q);
  sp.set("page", String(p + 1));
  if (opts.set) for (const [k, v] of Object.entries(opts.set)) sp.set(k, v);
  if (opts.drop) sp.delete(opts.drop);
  return `?${sp.toString()}`;
}
