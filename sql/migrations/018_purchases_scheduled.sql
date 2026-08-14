-- 018_purchases_scheduled.sql
--
-- Agendamento (Pay After Delivery): pedido que o cliente combina de pagar
-- DEPOIS de receber. Entra no dashboard atribuído ao criativo (match por
-- telefone, igual boleto/PIX gerado), MAS não dispara Purchase no Meta enquanto
-- está agendado. Quando o pagamento confirma depois, o webhook faz a transição
-- normal pra 'approved' (aí sim dispara Purchase — mesmo fluxo do boleto→pago).
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO. O webhook passa a gravar status
-- 'scheduled' + scheduled_at; sem a coluna/CHECK o PostgREST rejeita o upsert
-- inteiro (coluna/valor inexistente) e o pedido não é gravado.
--
--   1. Amplia o CHECK de status pra aceitar 'scheduled'.
--   2. Coluna scheduled_at: momento do agendamento. PERSISTENTE — se o pedido
--      for pago depois e virar 'approved', o scheduled_at permanece, pra a
--      contagem de agendamentos por período continuar fiel (mesma ideia do
--      approved_at da migration 016). A coluna AGENDAMENTO da árvore conta por
--      scheduled_at, independente do status final.
--
-- Idempotente: pode re-rodar sem efeito colateral.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) CHECK de status aceita 'scheduled' ───────────────────────────────────
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('approved', 'refunded', 'pending', 'refused', 'scheduled'));

-- ── 2) CHECK de source aceita 'skale' ───────────────────────────────────────
-- Skale Tracking é uma nova origem de pedidos (Pay After Delivery). O webhook
-- /api/webhook/skale grava source='skale'.
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('payt', 'manual', 'luminar-pay', 'skale'));

-- ── 3) Coluna scheduled_at ──────────────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS purchases_scheduled_at_idx
  ON public.purchases(scheduled_at DESC);
