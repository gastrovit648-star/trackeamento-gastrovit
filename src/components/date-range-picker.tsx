"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useTransition } from "react";
import { format, subDays, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Loader2 } from "lucide-react";

const TIMEZONE = "America/Sao_Paulo";

const PRESETS = [
  { label: "Hoje", days: 0 },
  { label: "Ontem", days: 1 },
  { label: "7d", days: 6 },
  { label: "30d", days: 29 },
];

function formatForInput(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

type Props = { maxDays?: number };

function DateRangePickerInner({ maxDays }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const now = toZonedTime(new Date(), TIMEZONE);
  // Default: hoje (mesmo dia) — alinhado com getDateRange em queries.ts
  const defaultFrom = formatForInput(startOfDay(now));
  const defaultTo = formatForInput(startOfDay(now));

  const fromParam = searchParams.get("from") || defaultFrom;
  const toParam = searchParams.get("to") || defaultTo;

  const [fromDate, setFromDate] = useState(fromParam);
  const [toDate, setToDate] = useState(toParam);

  useEffect(() => {
    setFromDate(fromParam);
    setToDate(toParam);
  }, [fromParam, toParam]);

  function clampFrom(from: string, to: string): string {
    if (!maxDays) return from;
    const toD = new Date(to);
    const fromD = new Date(from);
    const minD = new Date(toD.getTime() - (maxDays - 1) * 86400000);
    return fromD < minD ? formatForInput(minD) : from;
  }

  function apply(from: string, to: string) {
    // Preserva outros searchParams (account, status, page, etc) — só
    // troca from/to. Sem isso, trocar período resetava todos os filtros.
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", clampFrom(from, to));
    params.set("to", to);
    // MAS o filtro por criativo (deep-link do ranking, ?creative/?creativeId) é
    // uma exploração pontual — se ele grudar aqui, a tela de Campanhas fica
    // travada num criativo a cada troca de período. Então limpa ao mudar a data.
    params.delete("creative");
    params.delete("creativeId");
    window.dispatchEvent(new Event("nav:start"));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function handlePreset(days: number) {
    const to = formatForInput(startOfDay(now));
    const from = days === 1
      ? formatForInput(startOfDay(subDays(now, 1)))
      : formatForInput(startOfDay(subDays(now, days)));
    const toVal = days === 1 ? from : to;
    setFromDate(from);
    setToDate(toVal);
    apply(from, toVal);
  }

  function handleApply() {
    apply(fromDate, toDate);
  }

  function isPresetActive(days: number): boolean {
    const expectedTo = days === 1
      ? formatForInput(startOfDay(subDays(now, 1)))
      : formatForInput(startOfDay(now));
    const expectedFrom = days === 1
      ? formatForInput(startOfDay(subDays(now, 1)))
      : formatForInput(startOfDay(subDays(now, days)));
    return fromDate === expectedFrom && toDate === expectedTo;
  }

  const visiblePresets = maxDays ? PRESETS.filter((p) => p.days < maxDays) : PRESETS;
  const minFromInput = maxDays
    ? formatForInput(startOfDay(subDays(new Date(toDate), maxDays - 1)))
    : undefined;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
      {/* Preset pills agrupadas — segmento único com bordas internas */}
      <div className="inline-flex items-center rounded-md border border-border/80 bg-background/50 overflow-hidden">
        {visiblePresets.map((p, i) => {
          const active = isPresetActive(p.days);
          return (
            <button
              key={p.label}
              onClick={() => handlePreset(p.days)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                i > 0 ? "border-l border-border/60" : ""
              } ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          type="date"
          value={fromDate}
          min={minFromInput}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-8 px-2 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground min-w-0 flex-1 sm:flex-none sm:w-auto focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-[10px] text-muted-foreground/70 shrink-0 uppercase tracking-wider">a</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-8 px-2 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground min-w-0 flex-1 sm:flex-none sm:w-auto focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleApply}
          disabled={isPending}
          className="h-8 px-3 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-70 inline-flex items-center gap-1.5 shrink-0"
        >
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? "…" : "Aplicar"}
        </button>
      </div>
    </div>
  );
}

export function DateRangePicker({ maxDays }: Props = {}) {
  return (
    <Suspense fallback={<div className="h-8 w-48 rounded-md bg-muted animate-pulse" />}>
      <DateRangePickerInner maxDays={maxDays} />
    </Suspense>
  );
}
