"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import type { Project } from "@/lib/projects";
import { ProjectSelector } from "./project-selector";

const COLLAPSE_KEY = "tracking:sidebar-collapsed";

function SidebarInner({ projects }: { projects: Project[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);          // menu mobile (translate)
  const [collapsed, setCollapsed] = useState(false); // recolher no desktop

  // Restaura o estado recolhido só após hidratar (localStorage não existe no SSR).
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // storage bloqueado — segue expandido
    }
  }, []);

  const toggleCollapsed = () =>
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignora */ }
      return next;
    });

  // Preserve filtros across navigation (data + conta).
  const persistParams = new URLSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const accountParam = searchParams.get("account");
  const projectParam = searchParams.get("project");
  if (fromParam) persistParams.set("from", fromParam);
  if (toParam) persistParams.set("to", toParam);
  if (accountParam) persistParams.set("account", accountParam);
  if (projectParam) persistParams.set("project", projectParam);
  const queryString = persistParams.toString() ? `?${persistParams.toString()}` : "";

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const nav = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-6 border-b border-border/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo.svg"
          alt="Sua Marca"
          className="h-9 w-9 rounded-md object-contain"
        />
        <div className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold tracking-tight leading-tight">
            Sua Marca
          </span>
          <span className="block text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground leading-tight mt-0.5">
            Tracking
          </span>
        </div>
        {/* Recolher — só no desktop (no mobile o menu já fecha pelo overlay) */}
        <button
          onClick={toggleCollapsed}
          className="hidden lg:inline-flex shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Recolher menu"
          title="Recolher menu"
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Seletor de projeto — escopa todo o dashboard ao nicho/modalidade */}
      <div className="px-3 pt-4 pb-1">
        <span className="block px-2 mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70">
          Projeto
        </span>
        <ProjectSelector projects={projects} onNavigate={() => setOpen(false)} />
      </div>

      {/* Nav label */}
      <div className="px-5 pt-4 pb-2">
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70">
          Navegação
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2.5 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={`${item.href}${queryString}`}
              onClick={() => {
                setOpen(false);
                if (!active) {
                  window.dispatchEvent(new Event("nav:start"));
                }
              }}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all",
                active
                  ? "text-foreground bg-accent/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
              )}
            >
              {/* Indicador ativo: barra vertical neon na esquerda */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full transition-all",
                  active
                    ? "h-5 bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
                    : "h-0 bg-transparent",
                )}
              />
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
                )}
                strokeWidth={active ? 2.25 : 1.75}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer info */}
      <div className="px-5 py-4 border-t border-border/50">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Sistema operacional
          </span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-3 left-3 z-50 p-2 rounded-md bg-card border border-border/80 shadow-lg lg:hidden hover:bg-accent transition-colors"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Botão flutuante de expandir — desktop, só quando recolhido. Fica na
          borda esquerda no meio da altura pra não cobrir o header. */}
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 items-center justify-center h-14 w-6 rounded-r-md bg-card border border-l-0 border-border/80 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shadow-md"
          aria-label="Expandir menu"
          title="Expandir menu"
        >
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}

      {/* Sidebar. Recolhido no desktop = lg:hidden (some do fluxo e o main,
          flex-1, ocupa tudo). Encolher a largura via flexbox esbarrava no
          min-width do conteúdo, então esconder é o caminho robusto. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-card/95 backdrop-blur-xl border-r border-border/60 flex flex-col transition-transform lg:translate-x-0 lg:static lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed && "lg:hidden",
        )}
      >
        {nav}
      </aside>
    </>
  );
}

export function Sidebar({ projects }: { projects: Project[] }) {
  return (
    <Suspense>
      <SidebarInner projects={projects} />
    </Suspense>
  );
}
