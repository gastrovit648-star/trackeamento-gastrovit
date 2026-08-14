export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import { getDateRange, getEventsLogList, getRecordContext } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateSP } from "@/lib/utils";
import { RecordDetailsDrawer } from "@/components/record-details-drawer";
import { ClickableRow } from "@/components/clickable-row";

function formatPhoneBR(p: string | null | undefined): string {
  if (!p) return "—";
  if (p.length === 13 && p.startsWith("55")) {
    return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`;
  }
  return p;
}

function statusBadge(s: "success" | "error" | "unknown") {
  if (s === "success") return <Badge>OK</Badge>;
  if (s === "error")   return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function eventBadge(name: string) {
  if (name === "Lead")     return <Badge variant="outline">Lead</Badge>;
  if (name === "Purchase") return <Badge>Purchase</Badge>;
  return <Badge variant="secondary">{name}</Badge>;
}

export default async function EventosPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; event?: string; page?: string; selected?: string };
}) {
  const { from, to } = getDateRange(searchParams);
  const supabase = createAdminClient();
  const eventName =
    searchParams.event === "Lead" || searchParams.event === "Purchase"
      ? searchParams.event
      : null;
  const page = searchParams.page ? Math.max(0, parseInt(searchParams.page) - 1) : 0;
  const pageSize = 50;
  const selectedId = searchParams.selected || null;

  const [{ rows, total }, details] = await Promise.all([
    getEventsLogList(supabase, from, to, { eventName, page, pageSize }),
    selectedId ? getRecordContext(supabase, "event", selectedId) : Promise.resolve(null),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Idade do evento — pra UI explicar quando payload/response sumiram (TTL 14d).
  const eventAgeDays = (createdAt: string) => {
    const ms = Date.now() - new Date(createdAt).getTime();
    return ms / (1000 * 60 * 60 * 24);
  };

  return (
    <div className="space-y-6">
      {details && (
        <RecordDetailsDrawer data={details} selectedEventId={selectedId} />
      )}

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <CardTitle>Eventos ({total})</CardTitle>
          <div className="flex gap-1 text-xs flex-wrap">
            <a
              href={mkHref(searchParams, 0, { drop: "event" })}
              className={`px-3 py-1 rounded border ${!eventName ? "bg-accent" : "hover:bg-accent"}`}
            >
              Todos
            </a>
            <a
              href={mkHref(searchParams, 0, { set: { event: "Lead" } })}
              className={`px-3 py-1 rounded border ${eventName === "Lead" ? "bg-accent" : "hover:bg-accent"}`}
            >
              Lead
            </a>
            <a
              href={mkHref(searchParams, 0, { set: { event: "Purchase" } })}
              className={`px-3 py-1 rounded border ${eventName === "Purchase" ? "bg-accent" : "hover:bg-accent"}`}
            >
              Purchase
            </a>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evento</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Pixel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead>Enviado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhum evento no período.
                  </TableCell>
                </TableRow>
              ) : rows.map(row => (
                <ClickableRow
                  key={row.id}
                  href={mkHref(searchParams, page, { set: { selected: row.id } })}
                >
                  <TableCell>{eventBadge(row.event_name)}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{formatPhoneBR(row.phone)}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{row.pixel_id ?? "—"}</TableCell>
                  <TableCell>{statusBadge(row.response_status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.has_payload ? "salvo" : eventAgeDays(row.created_at) > 14 ? "expirado" : "vazio"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateSP(row.created_at)}</TableCell>
                </ClickableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
  searchParams: { from?: string; to?: string; event?: string; page?: string; selected?: string },
  p: number,
  opts: { set?: Record<string, string>; drop?: string } = {},
) {
  const sp = new URLSearchParams();
  if (searchParams.from)     sp.set("from", searchParams.from);
  if (searchParams.to)       sp.set("to", searchParams.to);
  if (searchParams.event)    sp.set("event", searchParams.event);
  if (searchParams.selected) sp.set("selected", searchParams.selected);
  sp.set("page", String(p + 1));
  if (opts.set) {
    for (const [k, v] of Object.entries(opts.set)) sp.set(k, v);
  }
  if (opts.drop) sp.delete(opts.drop);
  return `?${sp.toString()}`;
}
