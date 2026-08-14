"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError("Erro de conexão: " + String(err));
      setLoading(false);
    }
  }

  const envOk = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* Backgrounds decorativos — atmospheric gradient mesh */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 50% 0%, hsl(var(--primary) / 0.08), transparent 60%),
            radial-gradient(ellipse 40% 40% at 0% 100%, hsl(var(--accent-cyan) / 0.05), transparent 70%),
            radial-gradient(ellipse 40% 40% at 100% 100%, hsl(var(--primary) / 0.04), transparent 70%)
          `,
        }}
      />
      {/* Grid faint pattern (só no dark) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none hidden dark:block opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 60% at center, black, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-[400px] mx-auto reveal-up">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="relative mb-4">
            {/* Glow behind logo */}
            <div
              aria-hidden
              className="absolute inset-0 -m-3 rounded-2xl bg-primary/20 blur-xl"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo.svg"
              alt="Sua Marca"
              className="relative h-16 w-16 rounded-xl object-contain border border-border/60 bg-card/60 backdrop-blur-sm p-1"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sua Marca</h1>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mt-2">
            Tracking · Analytics · Telemetry
          </p>
        </div>

        {/* Card */}
        <div className="glass-card rounded-xl p-7">
          <div className="mb-5">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              Acesso
            </span>
            <h2 className="text-base font-semibold mt-1">Entrar no painel</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full h-10 px-3 text-sm rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-1.5"
              >
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full h-10 px-3 text-sm font-mono rounded-md border border-border/80 bg-background/50 text-foreground placeholder:text-muted-foreground/50 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10">
                <span className="h-1 w-1 rounded-full bg-destructive shrink-0" />
                <p className="text-[11px] text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Autenticando…" : "Entrar"}
            </button>
          </form>
        </div>

        {/* Footer status */}
        <div className="flex items-center justify-center gap-2 mt-5">
          <span className={`h-1.5 w-1.5 rounded-full ${envOk ? "bg-primary pulse-dot" : "bg-destructive"}`} />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            {envOk ? "Supabase conectado" : "ERRO: SUPABASE_URL não configurada"}
          </span>
        </div>
      </div>
    </div>
  );
}
