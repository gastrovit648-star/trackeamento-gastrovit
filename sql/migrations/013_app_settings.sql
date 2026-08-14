-- ────────────────────────────────────────────────────────────────────────────
-- Migration: app_settings
-- Tabela key-value genérica para configurações operacionais editáveis pela UI
-- (sem precisar de env var / redeploy). Primeiro uso: cotação USD→BRL.
--
-- value é JSONB pra acomodar formatos diferentes por chave. Chave atual:
--   'usd_brl_rate' → { "mode": "auto" | "manual", "manual_rate": number | null }
--     - mode=auto   → cotação buscada ao vivo na AwesomeAPI (comportamento legado)
--     - mode=manual → usa manual_rate fixo (ex.: travar 5.50 num período)
--
-- Lida por src/lib/exchange-rate.ts (getUsdToBrlRate) via service_role.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
-- Config operacional: nada de público. Leitura via authenticated (a página de
-- configurações renderiza no servidor mas pode evoluir); escrita só service_role.
REVOKE ALL ON TABLE public.app_settings FROM anon;
GRANT SELECT ON TABLE public.app_settings TO authenticated;
GRANT ALL    ON TABLE public.app_settings TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read app_settings"
  ON public.app_settings FOR SELECT TO authenticated USING (true);

-- ── Seed: cotação em modo automático (preserva comportamento atual) ─────────
INSERT INTO public.app_settings (key, value)
VALUES ('usd_brl_rate', '{"mode":"auto","manual_rate":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
