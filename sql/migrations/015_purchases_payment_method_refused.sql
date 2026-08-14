-- ────────────────────────────────────────────────────────────────────────────
-- Migration: payment_method em purchases + status 'refused'
--
-- Motivação: o dashboard passa a mostrar (a) o faturamento dividido por
-- plataforma × método de pagamento (Luminar cartão/boleto/PIX, Payt etc.) e
-- (b) métricas de transações não-aprovadas: "Boleto gerado", "PIX gerado"
-- (payloads Luminar com payment_status=waiting_payment) e "Cartão recusado"
-- (payment_status=refused). Até aqui o webhook DESCARTAVA waiting_payment e
-- refused (caíam em unknown_status) e não guardava o método de pagamento.
--
--   1. Coluna purchases.payment_method ('credit_card' | 'boleto' | 'pix' |
--      NULL). Sem CHECK de valores: a normalização acontece no webhook
--      (parsePayt) e novos métodos não podem quebrar o insert.
--   2. Amplia o CHECK de status pra aceitar 'refused'.
--   3. Backfill de payment_method a partir do raw_webhook das vendas já
--      gravadas (transaction.payment_method — shape Luminar/Payt).
--
-- Idempotente: pode re-rodar sem efeito colateral.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Coluna payment_method ────────────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- ── 2) CHECK de status aceita 'refused' ─────────────────────────────────────
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('approved', 'refunded', 'pending', 'refused'));

-- ── 3) Backfill a partir do raw_webhook ─────────────────────────────────────
-- Mesma normalização do parsePayt (route.ts): pix / boleto / cartão.
UPDATE public.purchases
   SET payment_method = CASE
     WHEN method_raw LIKE '%pix%'                                    THEN 'pix'
     WHEN method_raw LIKE '%boleto%' OR method_raw LIKE '%billet%'
       OR method_raw LIKE '%bank_slip%'                              THEN 'boleto'
     WHEN method_raw LIKE '%card%'   OR method_raw LIKE '%credit%'
       OR method_raw LIKE '%cartao%' OR method_raw LIKE '%cartão%'   THEN 'credit_card'
     ELSE NULL
   END
  FROM (
    SELECT id AS pid,
           lower(coalesce(
             raw_webhook->'transaction'->>'payment_method',
             raw_webhook->>'payment_method',
             raw_webhook->'payment'->>'method',
             ''
           )) AS method_raw
      FROM public.purchases
     WHERE payment_method IS NULL AND raw_webhook IS NOT NULL
  ) src
 WHERE id = src.pid;

-- ── Verificação ─────────────────────────────────────────────────────────────
SELECT payment_method, status, count(*)
  FROM public.purchases
 GROUP BY payment_method, status
 ORDER BY payment_method NULLS LAST, status;
