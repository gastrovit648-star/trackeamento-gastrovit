-- ────────────────────────────────────────────────────────────────────────────
-- Migration: usd_brl_rates
-- Cotação USD→BRL travada POR DIA, preenchida manualmente pelo dashboard.
--
-- Contexto: o Meta NÃO expõe na API a taxa de câmbio que ele usa pra faturar
-- contas em USD (o insights devolve spend já na moeda da conta, sem o câmbio).
-- Então a cotação de cada dia é informada à mão em /dashboard/configuracoes e
-- o dashboard converte o gasto de cada dia pela taxa daquela data.
--
-- Precedência de cotação (ver src/lib/exchange-rate.ts e queries.ts):
--   1. usd_brl_rates[data]          ← esta tabela (override por dia)
--   2. app_settings.usd_brl_rate    ← fallback global (manual fixo ou auto live)
--
-- `date` é a data no fuso da conta (YYYY-MM-DD), batendo com date_start do
-- insights do Meta. Conexão direta (service_role) não é afetada pela Data API.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usd_brl_rates (
  date       DATE PRIMARY KEY,
  rate       NUMERIC(10,4) NOT NULL CHECK (rate > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER usd_brl_rates_updated_at
  BEFORE UPDATE ON public.usd_brl_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
REVOKE ALL ON TABLE public.usd_brl_rates FROM anon;
GRANT SELECT ON TABLE public.usd_brl_rates TO authenticated;
GRANT ALL    ON TABLE public.usd_brl_rates TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.usd_brl_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read usd_brl_rates"
  ON public.usd_brl_rates FOR SELECT TO authenticated USING (true);
