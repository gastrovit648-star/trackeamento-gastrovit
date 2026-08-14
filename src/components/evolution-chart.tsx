"use client";

import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { DailyPoint } from "@/lib/queries";

// Eixo Y de dinheiro fica ilegível com o valor cheio — versão compacta ("R$ 1,2k").
function compactBRL(v: number): string {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return `R$ ${Math.round(v)}`;
}

const COLORS = {
  revenue: "hsl(var(--primary))",
  spend: "hsl(var(--accent-amber))",
  roas: "hsl(var(--accent-cyan))",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const byKey: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of payload) byKey[p.dataKey] = p.value as number;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-mono text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-primary">Faturamento</span>
          <span className="font-mono">{formatCurrency(byKey.revenue ?? 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[hsl(var(--accent-amber))]">Gasto</span>
          <span className="font-mono">{formatCurrency(byKey.spend ?? 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[hsl(var(--accent-cyan))]">ROAS</span>
          <span className="font-mono">{(byKey.roas ?? 0) > 0 ? `${(byKey.roas ?? 0).toFixed(2)}×` : "—"}</span>
        </div>
      </div>
    </div>
  );
}

export function EvolutionChart({ data }: { data: DailyPoint[] }) {
  // Rótulo do eixo X em DD/MM (o date vem YYYY-MM-DD).
  const chartData = data.map(d => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
  const temDados = chartData.some(d => d.spend > 0 || d.revenue > 0 || d.leads > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolução diária</CardTitle>
      </CardHeader>
      <CardContent>
        {!temDados ? (
          <div className="py-12 text-center text-xs text-muted-foreground">Sem dados no período.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                yAxisId="money"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={compactBRL}
                width={54}
              />
              <YAxis
                yAxisId="roas"
                orientation="right"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}×`}
                width={34}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                iconType="plainline"
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => <span className="text-muted-foreground">{value}</span>}
              />
              <Line yAxisId="money" type="monotone" dataKey="revenue" name="Faturamento" stroke={COLORS.revenue} strokeWidth={2} dot={false} />
              <Line yAxisId="money" type="monotone" dataKey="spend" name="Gasto" stroke={COLORS.spend} strokeWidth={2} dot={false} />
              <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke={COLORS.roas} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
