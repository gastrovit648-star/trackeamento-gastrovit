import { cn } from "@/lib/utils";

interface StatRowProps {
  label: string;
  value: string;
  type?: "add" | "subtract" | "total";
}

export function StatRow({ label, value, type }: StatRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2 px-3",
        type === "total" && "border-t-2 font-bold mt-1 pt-3"
      )}
    >
      <span
        className={cn(
          "text-sm",
          type === "subtract" ? "text-destructive" : "text-foreground"
        )}
      >
        {type === "subtract" ? "- " : type === "add" ? "+ " : ""}
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          type === "subtract" ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}
