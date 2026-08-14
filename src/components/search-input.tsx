"use client";

import { useState, useTransition, FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";

interface Props {
  /** Texto placeholder do input */
  placeholder?: string;
  /** Nome do query param que recebe o termo (default: "q") */
  paramName?: string;
}

/**
 * Input de busca compartilhado. Aplica o termo via query param (?q=…)
 * preservando todos os outros searchParams. Reseta page=1 a cada submit.
 * Click no X limpa.
 *
 * Server components consomem o param e fazem o filtro no DB.
 */
export function SearchInput({ placeholder = "Buscar…", paramName = "q" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get(paramName) ?? "";
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function apply(newValue: string) {
    const sp = new URLSearchParams(params.toString());
    if (newValue.trim()) sp.set(paramName, newValue.trim());
    else sp.delete(paramName);
    sp.delete("page"); // sempre volta pra primeira pagina
    const qs = sp.toString();
    window.dispatchEvent(new Event("nav:start"));
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    apply(value);
  }

  function clear() {
    setValue("");
    apply("");
  }

  return (
    <form onSubmit={onSubmit} className="relative flex items-center w-full sm:w-auto group/search">
      <Search
        className="absolute left-2.5 h-3 w-3 text-muted-foreground/60 pointer-events-none transition-colors group-focus-within/search:text-foreground"
        strokeWidth={2}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-7 pr-7 w-full sm:w-72 text-[11px] font-mono rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
      />
      {(value || isPending) && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Limpar busca"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </form>
  );
}
