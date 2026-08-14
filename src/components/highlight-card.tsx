import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface HighlightCardProps {
  title: string;
  value: string;
  accent: "blue" | "green" | "red";
  icon?: LucideIcon;
  subtitle?: string;
  delay?: number;
}

/**
 * Card de destaque — usado pra métricas-rei (ROAS, Lucro). Tem glow
 * mais forte que o MetricCard regular pra criar hierarquia visual.
 *
 * Mapping de accent:
 *   - blue  → cyan (#67E8F9) reservado pra ROAS
 *   - green → neon green (primary) pra valores positivos
 *   - red   → coral (destructive) pra valores negativos
 */
export function HighlightCard({ title, value, accent, icon: Icon, subtitle, delay = 0 }: HighlightCardProps) {
  const cardClass =
    accent === "blue"  ? "glass-card-cyan"   :
    accent === "green" ? "glass-card-accent" :
    /* red */            "glass-card";

  const numberColor =
    accent === "blue"  ? "text-[hsl(var(--accent-cyan))]" :
    accent === "green" ? "text-primary" :
    /* red */            "text-destructive";

  const iconColor = numberColor;

  return (
    <div
      className={cn(
        cardClass,
        "rounded-lg p-5 reveal-up group transition-all duration-300 relative overflow-hidden",
        "hover:-translate-y-px",
      )}
      style={{ animationDelay: `${delay * 60}ms` }}
    >
      {/* Linha vertical de destaque na esquerda */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-3 bottom-3 w-px",
          accent === "blue"  ? "bg-[hsl(var(--accent-cyan))]" :
          accent === "green" ? "bg-primary" :
                               "bg-destructive",
        )}
      />
      <div className="flex items-start justify-between gap-3 relative">
        <div className="space-y-2 min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {title}
          </p>
          <p className={cn(
            "text-3xl font-mono tabular tracking-tight",
            numberColor,
          )}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground/80 font-mono">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className="shrink-0 rounded-md border border-border/60 p-1.5 bg-background/50">
            <Icon className={cn("h-3.5 w-3.5", iconColor)} strokeWidth={1.5} />
          </div>
        )}
      </div>
    </div>
  );
}
