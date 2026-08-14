import { cn } from "@/lib/utils";

const UTM_COLORS: Record<string, string> = {
  source: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  campaign: "bg-purple-500/15 text-purple-500 border-purple-500/30",
  medium: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  content: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  term: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  referrer: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30",
};

interface UtmTagProps {
  type: "source" | "campaign" | "medium" | "content" | "term" | "referrer";
  value: string;
  className?: string;
}

export function UtmTag({ type, value, className }: UtmTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        UTM_COLORS[type],
        className
      )}
    >
      <span className="opacity-70">{type}:</span>
      <span className="truncate max-w-[100px]">{value}</span>
    </span>
  );
}

interface UtmTagsProps {
  source?: string | null;
  campaign?: string | null;
  medium?: string | null;
  content?: string | null;
  term?: string | null;
  referrer?: string | null;
  className?: string;
}

export function UtmTags({ source, campaign, medium, content, term, referrer, className }: UtmTagsProps) {
  const hasUtms = source || campaign || medium || content || term;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {source && <UtmTag type="source" value={source} />}
      {campaign && <UtmTag type="campaign" value={campaign} />}
      {medium && <UtmTag type="medium" value={medium} />}
      {content && <UtmTag type="content" value={content} />}
      {term && <UtmTag type="term" value={term} />}
      {!hasUtms && referrer && <UtmTag type="referrer" value={referrer} />}
    </div>
  );
}
