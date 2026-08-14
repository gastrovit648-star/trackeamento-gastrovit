"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** id da purchase a excluir */
  id: string;
  /** rótulo curto pra confirmação (transaction_id ou produto) */
  label?: string;
}

/**
 * Botão de excluir venda — usado na tabela de /dashboard/vendas para remover
 * vendas geradas erradas. Pede confirmação, chama DELETE /api/purchases/[id]
 * e faz router.refresh() pra sumir a linha do dashboard.
 *
 * Renderiza um <button>, então o ClickableRow da linha ignora o clique
 * (checa closest("a, button")) e não abre o drawer.
 */
export function DeletePurchaseButton({ id, label }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    const alvo = label ? `a venda "${label}"` : "esta venda";
    if (!window.confirm(`Excluir ${alvo}? Esta ação remove a venda do dashboard e não pode ser desfeita.`)) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(`Falha ao excluir: ${body.error ?? res.statusText}`);
        setLoading(false);
        return;
      }
      router.refresh();
    } catch (err) {
      window.alert(`Falha ao excluir: ${err instanceof Error ? err.message : "erro desconhecido"}`);
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      title="Excluir venda"
      aria-label="Excluir venda"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  );
}
