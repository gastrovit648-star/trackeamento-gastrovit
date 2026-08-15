-- 022_purchases_source_braip.sql
--
-- Amplia o CHECK de purchases.source pra aceitar 'braip'. O webhook
-- /api/webhook/braip grava source='braip'; sem isso o upsert viola a constraint
-- e o postback quebra.
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO.
--
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('payt', 'manual', 'luminar-pay', 'skale', 'braip'));
