"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "@/lib/constants";
import { DateRangePicker } from "./date-range-picker";
import { AccountSelector } from "./account-selector";
import { ThemeToggle } from "./theme-toggle";
import { EventHealthBadge } from "./event-health-badge";
import { LogOut, RefreshCw } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { revalidateMetaInsights } from "@/app/dashboard/actions";

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h`;
}

const HIDE_ACCOUNT_SELECTOR_ON = ["/dashboard/configuracoes"];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [lastFetchedAt, setLastFetchedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => { setLastFetchedAt(Date.now()); }, [pathname]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const current = NAV_ITEMS.find((item) => {
    if (item.href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(item.href);
  });

  const showAccountSelector = !HIDE_ACCOUNT_SELECTOR_ON.some(p => pathname.startsWith(p));

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleRefresh() {
    startTransition(async () => {
      await revalidateMetaInsights();
      setLastFetchedAt(Date.now());
      router.refresh();
    });
  }

  const ageSec = Math.floor((now - lastFetchedAt) / 1000);

  return (
    <header className="relative z-30 flex items-center justify-between px-4 lg:px-6 h-auto min-h-[64px] py-3 border-b border-border/60 bg-card/40 backdrop-blur-xl gap-4 flex-wrap">
      {/* Linha guia decorativa no topo — só visível no dark */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent dark:via-primary/30"
      />

      {/* Título da página + breadcrumb fino */}
      <div className="flex items-center gap-3 pl-12 lg:pl-0 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 leading-none">
            Dashboard
          </span>
          <h1 className="text-lg font-semibold text-foreground tracking-tight leading-tight mt-0.5 truncate">
            {current?.label || "Overview"}
          </h1>
        </div>
      </div>

      {/* Cluster direito */}
      <div className="flex items-center gap-2 flex-wrap">
        <EventHealthBadge />
        {showAccountSelector && <AccountSelector />}
        <DateRangePicker />

        {/* Last updated + refresh */}
        <div className="hidden sm:flex items-center gap-1.5 pl-2 ml-1 border-l border-border/60">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
            há {formatAge(ageSec)}
          </span>
          <button
            onClick={handleRefresh}
            disabled={isPending}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Atualizar"
            title="Forçar refresh dos dados Meta"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
        </div>

        {/* Theme + Logout */}
        <div className="flex items-center gap-0.5 pl-1 ml-1 border-l border-border/60">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </header>
  );
}
