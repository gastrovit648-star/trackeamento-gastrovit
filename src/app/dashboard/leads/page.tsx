export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import { getDateRange, getLeadsList, getRecordContext } from "@/lib/queries";
import { resolveProjectScope } from "@/lib/projects";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateSP } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { RecordDetailsDrawer } from "@/components/record-details-drawer";
import { SearchInput } from "@/components/search-input";
import { ClickableRow } from "@/components/clickable-row";

function formatPhoneBR(p: string | null | undefined): string {
  if (!p) return "—";
  // 5511987654321 → +55 (11) 98765-4321
  if (p.length === 13 && p.startsWith("55")) {
    return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`;
  }
  return p;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; account?: string; page?: string; selected?: string; q?: string; project?: string };
}) {
  const { from, to } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const adAccountFilter = searchParams.account || null;
  const search = searchParams.q || null;
  const page = searchParams.page ? Math.max(0, parseInt(searchParams.page) - 1) : 0;
  const pageSize = 50;
  const selectedId = searchParams.selected || null;
  const { projectAccountIds } = await resolveProjectScope(supabase, searchParams.project);

  const [{ rows, total }, details] = await Promise.all([
    getLeadsList(supabase, from, to, {
      adAccountId: adAccountFilter,
      projectAccountIds,
      search,
      page,
      pageSize,
    }),
    selectedId ? getRecordContext(supabase, "lead", selectedId) : Promise.resolve(null),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {details && (
        <RecordDetailsDrawer data={details} />
      )}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <CardTitle>Leads ({total})</CardTitle>
          <SearchInput placeholder="Buscar por telefone…" />
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefone</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Conjunto</TableHead>
                <TableHead>Anúncio</TableHead>
                <TableHead>Criativo</TableHead>
                <TableHead>CTWA Click ID</TableHead>
                <TableHead>Recebido em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum lead no período.
                  </TableCell>
                </TableRow>
              ) : rows.map(r => {
                const row = r as {
                  id: string;
                  phone: string;
                  ctwa_clid: string | null;
                  campaign_name: string | null;
                  adset_name: string | null;
                  ad_name: string | null;
                  source_url: string | null;
                  created_at: string;
                };
                return (
                  <ClickableRow
                    key={row.id}
                    href={mkLeadHref(searchParams, page, { set: { selected: row.id } })}
                  >
                    <TableCell className="font-mono text-xs">{formatPhoneBR(row.phone)}</TableCell>
                    <TableCell className="text-xs">{row.campaign_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{row.adset_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{row.ad_name || <span className="text-muted-foreground">—</span>}</TableCell>
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
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {row.ctwa_clid ? <Badge variant="outline">{row.ctwa_clid.slice(0, 12)}…</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateSP(row.created_at)}</TableCell>
                  </ClickableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} searchParams={searchParams} />
      )}
    </div>
  );
}

function mkLeadHref(
  searchParams: { from?: string; to?: string; account?: string; page?: string; selected?: string; q?: string; project?: string },
  p: number,
  opts: { set?: Record<string, string>; drop?: string } = {},
) {
  const sp = new URLSearchParams();
  if (searchParams.from)     sp.set("from", searchParams.from);
  if (searchParams.to)       sp.set("to", searchParams.to);
  if (searchParams.account)  sp.set("account", searchParams.account);
  if (searchParams.project)  sp.set("project", searchParams.project);
  if (searchParams.selected) sp.set("selected", searchParams.selected);
  if (searchParams.q)        sp.set("q", searchParams.q);
  sp.set("page", String(p + 1));
  if (opts.set) for (const [k, v] of Object.entries(opts.set)) sp.set(k, v);
  if (opts.drop) sp.delete(opts.drop);
  return `?${sp.toString()}`;
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: { from?: string; to?: string; account?: string; page?: string; selected?: string; project?: string };
}) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground">Página {page + 1} de {totalPages}</span>
      {page > 0 && <a href={mkLeadHref(searchParams, page - 1)} className="px-3 py-1 rounded border hover:bg-accent">Anterior</a>}
      {page < totalPages - 1 && <a href={mkLeadHref(searchParams, page + 1)} className="px-3 py-1 rounded border hover:bg-accent">Próxima</a>}
    </div>
  );
}
