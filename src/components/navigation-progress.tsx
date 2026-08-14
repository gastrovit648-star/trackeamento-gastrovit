"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Barra de progresso indeterminada no topo da tela. Ativa quando algum
 * componente dispara `window.dispatchEvent(new Event("nav:start"))` e
 * desativa quando pathname ou searchParams mudam (Next App Router não
 * expõe eventos nativos de navegação então fazemos manual).
 *
 * Usada pelos componentes de filtro (DateRangePicker, AccountSelector,
 * Sidebar). Dá feedback visual de que algo está acontecendo enquanto
 * o server component renderiza a nova rota.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const lastNavKey = useRef("");

  // Detecta começo de navegação via custom event
  useEffect(() => {
    const onStart = () => setActive(true);
    window.addEventListener("nav:start", onStart);
    return () => window.removeEventListener("nav:start", onStart);
  }, []);

  // Detecta fim de navegação via mudança de pathname/searchParams
  useEffect(() => {
    const key = `${pathname}?${searchParams.toString()}`;
    if (key !== lastNavKey.current) {
      lastNavKey.current = key;
      setActive(false);
    }
  }, [pathname, searchParams]);

  if (!active) return null;

  return (
    <div className="fixed top-0 left-0 right-0 h-0.5 z-[100] bg-transparent overflow-hidden pointer-events-none">
      <div
        className="h-full bg-primary"
        style={{
          width: "30%",
          animation: "nav-progress 1.2s ease-in-out infinite",
        }}
      />
    </div>
  );
}
