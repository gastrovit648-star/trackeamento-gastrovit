"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PERIOD_OPTIONS, DEFAULT_PERIOD } from "@/lib/constants";
import { Suspense } from "react";

function PeriodSelectorInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("period") || DEFAULT_PERIOD;

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {PERIOD_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function PeriodSelector() {
  return (
    <Suspense fallback={<div className="h-9 w-24 rounded-md border border-input bg-background animate-pulse" />}>
      <PeriodSelectorInner />
    </Suspense>
  );
}
