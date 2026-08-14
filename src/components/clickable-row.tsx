"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface Props {
  href: string;
  children: ReactNode;
  /** Override de className do <tr> */
  className?: string;
}

/**
 * Wrapper de TableRow que faz a linha inteira clicável (router.push).
 * Disparado por window event "nav:start" pra mostrar barra de progresso
 * global enquanto a página carrega.
 *
 * Cliques em links/buttons DENTRO da row continuam funcionando — o
 * onClick checa `closest("a, button")` antes de navegar.
 */
export function ClickableRow({ href, children, className }: Props) {
  const router = useRouter();
  return (
    <TableRow
      onClick={(e) => {
        // Se o clique foi em algo interativo dentro da row, deixa passar
        const target = e.target as HTMLElement;
        if (target.closest("a, button, input, [role=button]")) return;
        window.dispatchEvent(new Event("nav:start"));
        router.push(href);
      }}
      className={cn("cursor-pointer", className)}
    >
      {children}
    </TableRow>
  );
}
