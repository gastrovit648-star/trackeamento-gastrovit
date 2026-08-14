"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";

interface Health {
  window_hours: number;
  total: number;
  errors: number;
  error_rate: number;
  has_token_error: boolean;
  top_error_code: number | null;
}

/**
 * Badge no header que mostra saúde do envio CAPI nas últimas 24h.
 * Refetch a cada 60s. Clicar leva pra /dashboard/eventos.
 *
 * Estados visuais:
 *   - cinza: 0 eventos no período (nada disparado ainda)
 *   - verde: 0 erros OU error_rate < 5%
 *   - amarelo: error_rate entre 5%-20%
 *   - vermelho: error_rate > 20% OU has_token_error
 */
export function EventHealthBadge() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let aborted = false;
    async function load() {
      try {
        const res = await fetch("/api/events/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Health;
        if (!aborted) setHealth(data);
      } catch {
        /* silent */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { aborted = true; clearInterval(id); };
  }, []);

  if (!health) return null;

  // Sem eventos no período — não mostra nada (evita poluir o header)
  if (health.total === 0) return null;

  const rate = health.error_rate;
  let tone: "ok" | "warn" | "danger";
  let Icon = CheckCircle2;
  let label = `${health.total} eventos OK`;
  let title = `${health.total} eventos enviados nas últimas 24h, ${health.errors} erro(s)`;

  if (health.has_token_error) {
    tone = "danger";
    Icon = AlertCircle;
    label = "Token inválido";
    title = `Detectado erro de token (code 190 ou 102) — regenere o Access Token do pixel`;
  } else if (rate > 0.2) {
    tone = "danger";
    Icon = AlertTriangle;
    label = `${health.errors} erros (${Math.round(rate * 100)}%)`;
    title = `Taxa de erro alta — ${health.errors} de ${health.total} eventos falharam${
      health.top_error_code ? ` (code ${health.top_error_code})` : ""
    }`;
  } else if (rate >= 0.05) {
    tone = "warn";
    Icon = AlertTriangle;
    label = `${health.errors} erros`;
    title = `${health.errors} de ${health.total} eventos falharam${
      health.top_error_code ? ` (code ${health.top_error_code})` : ""
    }`;
  } else {
    tone = "ok";
  }

  const colorClass =
    tone === "danger"
      ? "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
      : tone === "warn"
        ? "bg-[hsl(var(--accent-amber)/0.15)] text-[hsl(var(--accent-amber))] border-[hsl(var(--accent-amber)/0.3)] hover:bg-[hsl(var(--accent-amber)/0.25)]"
        : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20";

  return (
    <Link
      href="/dashboard/eventos"
      title={title}
      className={`hidden md:inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-[11px] font-medium transition-colors ${colorClass}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </Link>
  );
}
