-- ────────────────────────────────────────────────────────────────────────────
-- Migration: produtos + coluna source em purchases (eventos manuais)
--
-- Motivação: permitir registro de vendas que não passam pelo gateway Payt
-- (vendas presenciais, manuais, ajustes). Novo módulo /dashboard/eventos-manuais
-- usa essas tabelas + nova rota /api/manual-purchase que dispara CAPI fan-out
-- igual o webhook Payt.
--
-- products: catálogo simples (id, nome, valor padrão, ativo).
-- purchases.source: discrimina origem ('payt' vs 'manual') pra filtragem
-- na listagem de vendas. Default 'payt' preserva semântica das vendas
-- existentes sem precisar backfill.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Tabela products ──────────────────────────────────────────────────────
CREATE TABLE public.products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  value       NUMERIC(10,2) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX products_active_idx ON public.products(is_active) WHERE is_active = TRUE;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

REVOKE ALL ON TABLE public.products FROM anon;
GRANT SELECT ON TABLE public.products TO authenticated;
GRANT ALL    ON TABLE public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read products"
  ON public.products FOR SELECT TO authenticated USING (true);

-- ── 2) Coluna source em purchases ───────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'payt'
    CHECK (source IN ('payt', 'manual'));

CREATE INDEX IF NOT EXISTS purchases_source_idx ON public.purchases(source);
