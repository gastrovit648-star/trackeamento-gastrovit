"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2 } from "lucide-react";

interface Props {
  /** id da purchase a corrigir */
  id: string;
}

/**
 * Botão "Corrigir telefone" — aparece no drawer de detalhes só quando a venda
 * está sem match (matched_lead=false), tipicamente porque o cliente digitou o
 * número errado no checkout. Abre um campo pro operador informar o número certo
 * e chama PATCH /api/purchases/[id], que normaliza, recalcula o hash e refaz o
 * match com o lead — a mesma lógica do webhook, sem SQL na mão.
 *
 * Fluxo de "sem lead": se o número corrigido não bate com nenhum lead, a API
 * responde 409 { no_lead } e aqui a gente pergunta se corrige o telefone mesmo
 * assim (venda fica sem atribuição). Só então reenvia com allowNoMatch.
 */
export function FixPhoneButton({ id }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(allowNoMatch: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: value, allowNoMatch }),
      });
      const json = await res.json().catch(() => ({}));

      // Sem lead com esse número — confirma se corrige o telefone mesmo assim.
      if (res.status === 409 && json.no_lead) {
        setLoading(false);
        const ok = window.confirm(
          "Não encontrei um lead com esse número. Corrigir o telefone da venda " +
          "mesmo assim? A venda fica com o número certo, mas sem atribuição de campanha.",
        );
        if (ok) submit(true);
        return;
      }

      if (!res.ok) {
        setError(json.error ?? "Falha ao corrigir o telefone.");
        setLoading(false);
        return;
      }

      // Sucesso — recarrega o drawer com o telefone corrigido e a atribuição.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
      >
        <Pencil className="h-3 w-3" strokeWidth={1.75} />
        Corrigir telefone
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !loading) submit(false);
            if (e.key === "Escape") { setEditing(false); setError(null); }
          }}
          placeholder="(DDD) 9xxxx-xxxx"
          disabled={loading}
          className="h-7 flex-1 min-w-0 px-2 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={loading || !value.trim()}
          title="Corrigir e refazer match"
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-primary/40 bg-primary/10 text-[11px] text-primary hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading
            ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
            : <Check className="h-3 w-3" strokeWidth={1.75} />}
          Refazer match
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); setValue(""); }}
          disabled={loading}
          title="Cancelar"
          aria-label="Cancelar"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
