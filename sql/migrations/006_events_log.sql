-- ────────────────────────────────────────────────────────────────────────────
-- Migration: events_log
-- Log de todo evento enviado ao Meta CAPI (Lead e Purchase). event_id é
-- UNIQUE pra deduplicação determinística.
--
-- Sem GA4 nesta versão — não há tracking client-side via gtag (todo o
-- funil é WhatsApp → Payt, server-side).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.events_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT,                              -- identificador da pessoa
  event_name    TEXT NOT NULL,                     -- Lead | Purchase
  event_id      TEXT NOT NULL UNIQUE,              -- determinístico, dedup nativo no Meta
  pixel_id      TEXT,                              -- pixel string (não FK pra log resistir a delete)
  payload_meta  JSONB,
  response_meta JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX events_log_phone_idx      ON public.events_log(phone);
CREATE INDEX events_log_event_name_idx ON public.events_log(event_name);
CREATE INDEX events_log_created_at_idx ON public.events_log(created_at DESC);

REVOKE ALL ON TABLE public.events_log FROM anon;
GRANT SELECT ON TABLE public.events_log TO authenticated;
GRANT ALL    ON TABLE public.events_log TO service_role;

ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read events_log"
  ON public.events_log FOR SELECT TO authenticated USING (true);
