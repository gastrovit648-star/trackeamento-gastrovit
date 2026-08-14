"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";

interface AdAccountLite {
  id: string;
  name: string;
  account_id: string;
  is_active: boolean;
}

export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("account") ?? "all";
  const project = params.get("project");

  const [accounts, setAccounts] = useState<AdAccountLite[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Busca as contas escopadas ao projeto ativo (re-busca ao trocar de projeto).
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/ad-accounts${project ? `?project=${encodeURIComponent(project)}` : ""}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancel) {
          setAccounts(
            (json.data as AdAccountLite[]).filter(a => a.is_active),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cancel = true; };
  }, [project]);

  function pick(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("account");
    else sp.set("account", value);
    // Não arrasta o filtro por criativo (deep-link do ranking) ao trocar de
    // conta — senão a árvore de Campanhas fica presa num criativo.
    sp.delete("creative");
    sp.delete("creativeId");
    const qs = sp.toString();
    setOpen(false);
    window.dispatchEvent(new Event("nav:start"));
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const currentLabel =
    selected === "all"
      ? "Todas as contas"
      : accounts.find(a => a.id === selected)?.name ?? "Conta";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isPending}
        className="group flex items-center gap-2 h-8 px-2.5 rounded-md border border-border/80 bg-background/50 hover:bg-accent transition-colors disabled:opacity-70 text-xs"
      >
        <span className="h-1 w-1 rounded-full bg-primary/60 group-hover:bg-primary transition-colors" />
        <span className="truncate max-w-[160px]">{currentLabel}</span>
        {isPending
          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 min-w-[260px] rounded-lg border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                Selecionar conta
              </span>
            </div>
            <button
              onClick={() => pick("all")}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 ${selected === "all" ? "bg-accent/50 text-foreground" : "text-muted-foreground"}`}
            >
              <span className={`h-1 w-1 rounded-full ${selected === "all" ? "bg-primary" : "bg-muted-foreground/40"}`} />
              Todas as contas
            </button>
            {accounts.length > 0 && <div className="h-px bg-border/60 mx-2" />}
            <div className="max-h-[300px] overflow-y-auto">
              {accounts.map(a => (
                <button
                  key={a.id}
                  onClick={() => pick(a.id)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 ${selected === a.id ? "bg-accent/50" : ""}`}
                >
                  <span className={`mt-1 h-1 w-1 rounded-full shrink-0 ${selected === a.id ? "bg-primary" : "bg-muted-foreground/40"}`} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{a.name}</span>
                    <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                      {a.account_id}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {accounts.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                Nenhuma conta ativa.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
