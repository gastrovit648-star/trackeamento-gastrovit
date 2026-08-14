-- ────────────────────────────────────────────────────────────────────────────
-- Migration: ad_accounts
-- Contas de anúncio do Meta cadastradas pelo dashboard. Cada row representa
-- um par (BM, conta de anúncio) com seu token de acesso. Usado por:
--   - /api/webhook/datacrazy → resolve campaign/adset/ad pelo source_id
--   - /dashboard/* → fetchCampaignInsights por conta
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.ad_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id        TEXT NOT NULL,
  account_id   TEXT NOT NULL UNIQUE,     -- sem prefixo "act_"
  name         TEXT NOT NULL,
  access_token TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ad_accounts_active_idx ON public.ad_accounts(is_active);

-- Trigger compartilhado de updated_at (reutilizado pelas próximas migrations)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER ad_accounts_updated_at
  BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
-- access_token é segredo: anon NUNCA pode ler. authenticated PODE ler porque
-- o dashboard exibe a tabela de contas (sem mostrar o token na UI — só name
-- e account_id no <select> e na tabela de configurações).
REVOKE ALL ON TABLE public.ad_accounts FROM anon;
GRANT SELECT ON TABLE public.ad_accounts TO authenticated;
GRANT ALL    ON TABLE public.ad_accounts TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ad_accounts"
  ON public.ad_accounts FOR SELECT TO authenticated USING (true);
