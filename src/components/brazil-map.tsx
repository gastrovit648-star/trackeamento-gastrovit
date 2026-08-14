"use client";

import { useState, useRef } from "react";
import { formatCurrency } from "@/lib/utils";
import brazilPaths from "@/lib/brazil-paths.json";

interface StateData {
  uf: string;
  count: number;
  revenue: number;
}

interface Props {
  data: StateData[];
}

// Paths SVG pré-projetados (equirectangular com aspect ratio corrigido
// pra latitude central do Brasil). Geo data: click_that_hood/brazil-states.
// viewBox: 0 0 1000 1000.
const PATHS = brazilPaths as Record<string, { name: string; d: string }>;

export function BrazilMap({ data }: Props) {
  const [hover, setHover] = useState<{ uf: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const byUF = new Map(data.map(d => [d.uf, d]));
  const maxCount = Math.max(1, ...data.map(d => d.count));
  const totalCount = data.reduce((s, d) => s + d.count, 0);

  function intensity(count: number): number {
    if (count === 0) return 0;
    return Math.min(1, Math.log1p(count) / Math.log1p(maxCount));
  }

  function fillFor(uf: string): string {
    const d = byUF.get(uf);
    if (!d) return "hsl(var(--muted) / 0.4)";
    const i = intensity(d.count);
    return `hsl(var(--primary) / ${0.15 + i * 0.75})`;
  }

  function strokeFor(uf: string, isHover: boolean): string {
    if (isHover) return "hsl(var(--primary))";
    const d = byUF.get(uf);
    if (!d) return "hsl(var(--border))";
    const i = intensity(d.count);
    return `hsl(var(--primary) / ${0.4 + i * 0.3})`;
  }

  const hoverData = hover ? byUF.get(hover.uf) : null;
  const hoverName = hover ? PATHS[hover.uf]?.name : null;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="relative w-full mx-auto"
        style={{ aspectRatio: "1 / 1", maxWidth: 560 }}
      >
        <svg
          viewBox="0 0 1000 1000"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {Object.entries(PATHS).map(([uf, { d }]) => {
            const isHover = hover?.uf === uf;
            return (
              <path
                key={uf}
                d={d}
                fill={fillFor(uf)}
                stroke={strokeFor(uf, isHover)}
                strokeWidth={isHover ? 2.5 : 1}
                strokeLinejoin="round"
                style={{
                  cursor: "pointer",
                  transition: "fill 200ms, stroke 200ms, stroke-width 200ms",
                  filter: isHover ? "brightness(1.2)" : "none",
                }}
                onMouseEnter={(e) => {
                  const cont = containerRef.current?.getBoundingClientRect();
                  if (!cont) return;
                  const r = (e.currentTarget as SVGPathElement).getBoundingClientRect();
                  setHover({
                    uf,
                    x: r.left - cont.left + r.width / 2,
                    y: r.top - cont.top,
                  });
                }}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>

        {/* Tooltip flutuante */}
        {hover && (
          <div
            className="absolute z-10 pointer-events-none rounded-md border border-border bg-popover/95 backdrop-blur-md shadow-xl px-3 py-2 text-xs whitespace-nowrap"
            style={{ left: hover.x, top: hover.y - 8, transform: "translate(-50%, -100%)" }}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {hover.uf}
              </span>
              <span className="font-semibold">{hoverName}</span>
            </div>
            {hoverData ? (
              <div className="flex items-center gap-3 mt-1 font-mono text-[11px]">
                <span className="text-primary">
                  {hoverData.count} {hoverData.count === 1 ? "venda" : "vendas"}
                </span>
                <span className="text-muted-foreground">{formatCurrency(hoverData.revenue)}</span>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground mt-0.5">sem vendas</div>
            )}
          </div>
        )}
      </div>

      {/* Legenda + total */}
      <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-border/40">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          <span>Intensidade</span>
          <div className="flex items-center gap-0.5">
            {[0.2, 0.4, 0.6, 0.8, 1].map(a => (
              <span
                key={a}
                className="block h-3 w-5 rounded-sm border border-border"
                style={{ background: `hsl(var(--primary) / ${0.15 + a * 0.75})` }}
              />
            ))}
          </div>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          {totalCount} {totalCount === 1 ? "venda" : "vendas"} com geo
        </span>
      </div>
    </div>
  );
}
