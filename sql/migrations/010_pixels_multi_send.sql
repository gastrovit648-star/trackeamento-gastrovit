-- ────────────────────────────────────────────────────────────────────────────
-- Migration: pixels multi-send (fan-out paralelo)
--
-- Motivação: distribuir risco de banimento de BM. Hoje todo evento CAPI vai
-- pra 1 pixel só (is_default=true). Com fan-out, o mesmo evento é disparado
-- pra TODOS os pixels marcados como is_active. Se um BM cai, os outros
-- continuam recebendo sinal.
--
-- Mudanças:
--   1. pixels.is_active (default TRUE — backfill implícito, todos os pixels
--      existentes entram no fan-out automaticamente)
--   2. events_log.unique(event_id, pixel_id) — antes era unique(event_id)
--      simples, o que impedia gravar a mesma event_id para N pixels
--
-- is_default continua existindo (informacional, sem afetar roteamento).
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Coluna is_active em pixels ──────────────────────────────────────────
ALTER TABLE public.pixels
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS pixels_is_active_idx
  ON public.pixels(is_active) WHERE is_active = TRUE;

-- ── 2) events_log: unique composto (event_id, pixel_id) ────────────────────
-- A constraint antiga é o UNIQUE inline na coluna event_id (Postgres
-- nomeia como events_log_event_id_key). Sem dropar, o batch insert
-- de N pixels com mesmo event_id viola unique.
ALTER TABLE public.events_log
  DROP CONSTRAINT IF EXISTS events_log_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS events_log_event_id_pixel_id_uniq
  ON public.events_log(event_id, pixel_id);
