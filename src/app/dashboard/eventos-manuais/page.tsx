export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase";
import { ManualEventsTabs, type Product } from "@/components/manual-events-tabs";

export default async function EventosManuaisPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("id, product_id, name, value, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <span className="h-1 w-1 rounded-full bg-primary" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Lançamento manual de vendas
        </span>
        <span className="flex-1 h-px bg-border/60" />
      </div>
      <ManualEventsTabs initialProducts={(data ?? []) as Product[]} />
    </div>
  );
}
