"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronsUpDown, Check, FolderKanban, Settings2, Loader2 } from "lucide-react";
import type { Project } from "@/lib/projects";

/**
 * Seletor de projeto na sidebar. Escopa TODO o dashboard ao projeto escolhido
 * (grava ?project=<id>). "Todos os projetos" (sem param) mostra tudo agregado.
 *
 * Trocar de projeto é um RESET de contexto: preserva só o período (from/to) e
 * dropa account/creative/selected/status/etc. — que são específicos do projeto
 * anterior (uma conta do projeto A não existe no projeto B).
 */
export function ProjectSelector({
  projects,
  onNavigate,
}: {
  projects: Project[];
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("project"); // null = todos os projetos
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const current = projects.find(p => p.id === selected);
  const label = current?.name ?? "Todos os projetos";

  function pick(id: string | null) {
    const sp = new URLSearchParams();
    const from = params.get("from");
    const to = params.get("to");
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (id) sp.set("project", id);
    const qs = sp.toString();
    setOpen(false);
    onNavigate?.();
    window.dispatchEvent(new Event("nav:start"));
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isPending}
        className="w-full flex items-center gap-2 h-9 px-2.5 rounded-md border border-border/80 bg-background/50 hover:bg-accent transition-colors disabled:opacity-70 text-[13px]"
      >
        <FolderKanban className="h-3.5 w-3.5 text-primary shrink-0" strokeWidth={2} />
        <span className="truncate flex-1 text-left font-medium">{label}</span>
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1.5 rounded-lg border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl z-50 py-1 overflow-hidden">
            <button
              onClick={() => pick(null)}
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-accent flex items-center gap-2 ${!selected ? "text-foreground" : "text-muted-foreground"}`}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 text-primary ${!selected ? "opacity-100" : "opacity-0"}`} />
              Todos os projetos
            </button>
            {projects.length > 0 && <div className="h-px bg-border/60 mx-2 my-0.5" />}
            <div className="max-h-[280px] overflow-y-auto">
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => pick(p.id)}
                  className={`w-full text-left px-3 py-2 text-[13px] hover:bg-accent flex items-center gap-2 ${selected === p.id ? "bg-accent/40" : ""}`}
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 text-primary ${selected === p.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="h-px bg-border/60 mx-2 my-0.5" />
            <Link
              href="/dashboard/configuracoes?tab=projetos"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              Gerenciar projetos
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
