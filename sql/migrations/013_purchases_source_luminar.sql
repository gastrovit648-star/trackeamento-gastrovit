-- ────────────────────────────────────────────────────────────────────────────
-- Migration: adiciona 'luminar-pay' como origem (source) de purchases
--
-- Até aqui o webhook de vendas gravava TODA venda como source='payt' (o default
-- da coluna, migration 011), mesmo as que vêm da Luminar-pay. A Luminar é
-- identificada por integration_key/seller_id == 'luminar-pay' e posta no mesmo
-- endpoint da Payt.
--
-- Esta migration:
--   1. Amplia o CHECK de source pra aceitar 'luminar-pay'.
--   2. Reclassifica as vendas já gravadas cujo raw_webhook indica Luminar.
--
-- O webhook passa a gravar source corretamente daqui pra frente (route.ts).
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Amplia o CHECK constraint ────────────────────────────────────────────
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('payt', 'manual', 'luminar-pay'));

-- ── 2) Backfill das vendas Luminar já existentes ────────────────────────────
-- Identifica pelo payload cru salvo em raw_webhook (integration_key/seller_id).
UPDATE public.purchases
   SET source = 'luminar-pay'
 WHERE source = 'payt'
   AND (
        raw_webhook->>'integration_key' = 'luminar-pay'
     OR raw_webhook->>'seller_id'        = 'luminar-pay'
   );

-- ── Verificação ────────────────────────────────────────────────────────────
SELECT source, count(*) FROM public.purchases GROUP BY source ORDER BY source;
