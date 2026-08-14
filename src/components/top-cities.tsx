import { formatCurrency } from "@/lib/utils";

interface CityRow {
  city: string;
  uf: string | null;
  count: number;
  revenue: number;
}

interface Props {
  rows: CityRow[];
}

export function TopCities({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-8 text-center">
        Nenhuma cidade no período.
      </div>
    );
  }

  const maxCount = Math.max(1, ...rows.map(r => r.count));

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const pct = (r.count / maxCount) * 100;
        return (
          <div key={`${r.city}-${r.uf}-${i}`} className="group relative">
            <div className="relative flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs">
              {/* Barra de fundo proporcional */}
              <div
                className="absolute inset-y-0 left-0 rounded bg-primary/10 group-hover:bg-primary/15 transition-colors"
                style={{ width: `${pct}%` }}
              />
              {/* Conteúdo */}
              <div className="relative flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 w-5 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate font-medium">{r.city}</span>
                {r.uf && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {r.uf}
                  </span>
                )}
              </div>
              <div className="relative flex items-center gap-3 font-mono shrink-0">
                <span className="text-primary font-semibold">{r.count}</span>
                <span className="text-muted-foreground text-[10px] hidden sm:inline">
                  {formatCurrency(r.revenue)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
