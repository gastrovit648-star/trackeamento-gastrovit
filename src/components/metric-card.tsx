import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  icon?: LucideIcon;
  className?: string;
  /** Index pra stagger reveal — passa 0,1,2... pra criar onda */
  delay?: number;
  /** Linha pequena abaixo do valor principal (ex: "+ R$ X com imposto") */
  subtitle?: React.ReactNode;
}

export function MetricCard({ title, value, icon: Icon, className, delay = 0, subtitle }: MetricCardProps) {
  return (
    <div
      className={cn(
        "glass-card rounded-lg p-5 reveal-up group transition-all duration-300",
        "hover:border-foreground/20 hover:-translate-y-px",
        className,
      )}
      style={{ animationDelay: `${delay * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {title}
          </p>
          <p className="text-3xl font-mono tabular tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] font-mono text-muted-foreground/80">
              {subtitle}
            </p>
          )}
        </div>
        {Icon && (
          <div className="shrink-0 rounded-md border border-border/60 p-1.5 bg-background/50 transition-colors group-hover:border-foreground/20">
            <Icon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.5} />
          </div>
        )}
      </div>
    </div>
  );
}
