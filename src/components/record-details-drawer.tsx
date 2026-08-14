"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { X, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FixPhoneButton } from "@/components/fix-phone-button";
import { formatCurrency, formatDateSP } from "@/lib/utils";
import type { RecordContext } from "@/lib/queries";

interface Props {
  data: RecordContext;
  selectedEventId?: string | null;
}

function formatPhoneBR(p: string | null | undefined): string {
  if (!p) return "—";
  if (p.length === 13 && p.startsWith("55")) {
    return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`;
  }
  return p;
}

function adsManagerUrl(accountId: string, level: "campaign" | "adset" | "ad", id: string): string {
  const param =
    level === "campaign" ? "selected_campaign_ids" :
    level === "adset"    ? "selected_adset_ids"    : "selected_ad_ids";
  return `https://www.facebook.com/adsmanager/manager/accounts/?act=${accountId}&${param}=${id}`;
}

function eventBadge(name: string) {
  if (name === "Lead")     return <Badge variant="outline">Lead</Badge>;
  if (name === "Purchase") return <Badge variant="success">Purchase</Badge>;
  return <Badge variant="secondary">{name}</Badge>;
}

function statusBadge(s: "success" | "error" | "unknown") {
  if (s === "success") return <Badge variant="success">OK</Badge>;
  if (s === "error")   return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function purchaseStatusBadge(s: string) {
  if (s === "approved") return <Badge variant="success">Aprovada</Badge>;
  if (s === "refunded") return <Badge variant="destructive">Reembolsada</Badge>;
  if (s === "pending")  return <Badge variant="secondary">Pendente</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

/** Linha label-valor minimal — alinhamento left/right */
function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground shrink-0">
        {label}
      </span>
      <span className={`text-[12px] text-right break-all min-w-0 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/** Container de seção — card interno com label + conteúdo */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="h-1 w-1 rounded-full bg-primary" />
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </span>
        <span className="flex-1 h-px bg-border/40" />
      </div>
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 divide-y divide-border/30">
        {children}
      </div>
    </div>
  );
}

function Collapse({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 py-1 text-left hover:text-foreground transition-colors group"
      >
        <span className="h-1 w-1 rounded-full bg-muted-foreground/40 group-hover:bg-primary transition-colors" />
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
        <span className="flex-1 h-px bg-border/40" />
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function RecordDetailsDrawer({ data, selectedEventId }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const closeHref = (() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("selected");
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") window.location.href = closeHref;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref]);

  const { lead, adAccount, purchase, event, history } = data;
  const phone = data.phone;

  // Determina o tipo de contexto
  const kindLabel = event ? "Evento CAPI" : purchase ? "Venda" : "Lead";

  return (
    <>
      {/* Overlay full-screen (escurece o resto + bloqueia interação) */}
      <Link
        href={closeHref}
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[90]"
        aria-label="Fechar"
      />
      {/* Drawer fixo à direita — z-[100] pra ficar acima de TUDO (inclusive header) */}
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-card border-l border-border z-[100] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="flex flex-col">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 leading-none">
              {kindLabel}
            </span>
            <h2 className="text-[14px] font-semibold tracking-tight leading-tight mt-1">
              Detalhes
            </h2>
          </div>
          <Link
            href={closeHref}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </Link>
        </div>

        {/* HERO — destaque do registro principal */}
        <div className="px-5 py-4 border-b border-border/60 shrink-0">
          {purchase ? (
            <div className="flex items-baseline gap-3">
              <div className="text-2xl font-mono tabular font-semibold text-primary leading-none">
                {formatCurrency(Number(purchase.value))}
              </div>
              {purchaseStatusBadge(purchase.status)}
            </div>
          ) : event ? (
            <div className="flex items-center gap-2">
              {eventBadge(event.event_name)}
              {statusBadge(
                event.response_meta && typeof event.response_meta === "object" && "events_received" in event.response_meta && Number((event.response_meta as { events_received?: unknown }).events_received) > 0
                  ? "success"
                  : event.response_meta && "error" in (event.response_meta as object)
                    ? "error"
                    : "unknown",
              )}
            </div>
          ) : lead ? (
            <Badge variant="outline">Lead CTWA</Badge>
          ) : null}
          <div className="mt-2 font-mono text-[13px] text-foreground">
            {formatPhoneBR(phone)}
          </div>
          {(purchase?.product_name) && (
            <div className="mt-1 text-[12px] text-muted-foreground">
              {purchase.product_name}
            </div>
          )}
        </div>

        {/* Conteúdo scrollável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* USUÁRIO — só se tem dados além do phone (que já tá no hero) */}
          {(purchase?.email || purchase?.affiliate_email) && (
            <Section title="Usuário">
              {purchase?.email && <Row label="Email" value={purchase.email} mono />}
              {purchase?.affiliate_email && (
                <Row label="Afiliado" value={purchase.affiliate_email} mono />
              )}
            </Section>
          )}

          {/* VENDA — apenas em contexto de purchase */}
          {purchase && (
            <Section title="Venda">
              <Row label="Transaction ID" value={purchase.transaction_id} mono />
              <Row label="Match Lead" value={purchase.matched_lead ? <Badge variant="success">Sim</Badge> : <Badge variant="secondary">Não</Badge>} />
              <Row label="Data" value={formatDateSP(purchase.created_at)} mono />
              {/* Sem match: o cliente pode ter digitado o telefone errado no
                  checkout. Deixa corrigir o número e refazer o match na hora. */}
              {!purchase.matched_lead && (
                <div className="pt-2.5">
                  <FixPhoneButton id={purchase.id} />
                </div>
              )}
            </Section>
          )}

          {/* ATRIBUIÇÃO — sempre que tem lead matched */}
          {lead && (
            <Section title="Atribuição">
              {lead.ctwa_clid && (
                <Row
                  label="CTWA Click ID"
                  value={
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {lead.ctwa_clid.length > 32 ? `${lead.ctwa_clid.slice(0, 32)}…` : lead.ctwa_clid}
                    </span>
                  }
                />
              )}
              {lead.campaign_name && (
                <Row
                  label="Campanha"
                  value={
                    adAccount && lead.campaign_id
                      ? <a href={adsManagerUrl(adAccount.account_id, "campaign", lead.campaign_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {lead.campaign_name} <ExternalLink className="h-3 w-3" />
                        </a>
                      : lead.campaign_name
                  }
                />
              )}
              {lead.adset_name && (
                <Row
                  label="Conjunto"
                  value={
                    adAccount && lead.adset_id
                      ? <a href={adsManagerUrl(adAccount.account_id, "adset", lead.adset_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[hsl(var(--accent-cyan))] hover:underline">
                          {lead.adset_name} <ExternalLink className="h-3 w-3" />
                        </a>
                      : lead.adset_name
                  }
                />
              )}
              {lead.ad_name && (
                <Row
                  label="Anúncio"
                  value={
                    adAccount && lead.ad_id
                      ? <a href={adsManagerUrl(adAccount.account_id, "ad", lead.ad_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground hover:text-primary hover:underline transition-colors">
                          {lead.ad_name} <ExternalLink className="h-3 w-3" />
                        </a>
                      : lead.ad_name
                  }
                />
              )}
              {lead.source_url && (
                <Row
                  label="Criativo"
                  value={
                    <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Ver criativo <ExternalLink className="h-3 w-3" />
                    </a>
                  }
                />
              )}
              {adAccount && (
                <Row label="Conta Meta" value={<span className="font-mono text-[10px] text-muted-foreground">{adAccount.name}</span>} />
              )}
            </Section>
          )}

          {/* ENVIO CAPI — apenas quando aberto via /eventos */}
          {event && (
            <Section title="Envio CAPI">
              <Row label="event_id" value={<span className="text-[10px]">{event.event_id.length > 32 ? `${event.event_id.slice(0, 32)}…` : event.event_id}</span>} mono />
              {event.pixel_id && <Row label="Pixel" value={event.pixel_id} mono />}
              <Row label="Enviado em" value={formatDateSP(event.created_at)} mono />
            </Section>
          )}

          {/* Payloads & Webhooks brutos — collapsibles */}
          {event?.payload_meta && (
            <Collapse title="Payload enviado ao Meta">
              <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-64 border border-border/40">
                {JSON.stringify(event.payload_meta, null, 2)}
              </pre>
            </Collapse>
          )}
          {event?.response_meta && (
            <Collapse title="Resposta do Meta">
              <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-64 border border-border/40">
                {JSON.stringify(event.response_meta, null, 2)}
              </pre>
            </Collapse>
          )}
          {lead?.raw_webhook && (
            <Collapse title="Webhook bruto · DataCrazy">
              <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-64 border border-border/40">
                {JSON.stringify(lead.raw_webhook, null, 2)}
              </pre>
            </Collapse>
          )}
          {purchase?.raw_webhook && (
            <Collapse title="Webhook bruto · Payt">
              <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-64 border border-border/40">
                {JSON.stringify(purchase.raw_webhook, null, 2)}
              </pre>
            </Collapse>
          )}

          {/* HISTÓRICO — eventos do mesmo phone */}
          {history.length > 0 && (
            <Section title={`Histórico · ${history.length}`}>
              <div className="space-y-1 -mx-1 py-1">
                {history.map(h => {
                  const isSelected = selectedEventId === h.id;
                  const sp = new URLSearchParams(searchParams.toString());
                  sp.set("selected", h.id);
                  return (
                    <Link
                      key={h.id}
                      href={`/dashboard/eventos?${sp.toString()}`}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] transition-colors ${
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "hover:bg-accent/40"
                      }`}
                    >
                      {eventBadge(h.event_name)}
                      {statusBadge(h.response_status)}
                      <span className="ml-auto text-muted-foreground font-mono whitespace-nowrap text-[10px]">
                        {formatDateSP(h.created_at)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      </aside>
    </>
  );
}
