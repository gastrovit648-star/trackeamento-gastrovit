-- 019_pixels_capi_mode.sql
--
-- Controle POR PIXEL do que vai pro Meta CAPI (Purchase). Substitui o toggle
-- global "enviar Purchase no agendamento" por um modo por pixel:
--
--   capi_mode:
--     'sale'     → Purchase só na VENDA (pagamento). É o DEFAULT e o
--                  comportamento histórico (todo pixel recebe venda).
--     'schedule' → Purchase só no AGENDAMENTO (scheduled).
--     'both'     → Purchase no agendamento E na venda (o Meta dedupa por
--                  event_id, então conta uma vez — fica no agendamento).
--     'off'      → o pixel não recebe Purchase.
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO. O webhook passa a filtrar pixels por
-- capi_mode e a gravar capi_scheduled_at; sem as colunas o upsert/query falha.
--
--   1. pixels.capi_mode — default 'sale' (linhas existentes seguem só venda).
--   2. purchases.capi_scheduled_at — carimbo de quando o Purchase do
--      AGENDAMENTO foi enviado (idempotência: não reenvia em retries do webhook
--      de agendamento). O meta_event_id segue marcando o envio da VENDA.
--
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pixels
  ADD COLUMN IF NOT EXISTS capi_mode TEXT NOT NULL DEFAULT 'sale';

ALTER TABLE public.pixels DROP CONSTRAINT IF EXISTS pixels_capi_mode_check;
ALTER TABLE public.pixels
  ADD CONSTRAINT pixels_capi_mode_check
  CHECK (capi_mode IN ('sale', 'schedule', 'both', 'off'));

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS capi_scheduled_at TIMESTAMPTZ;
