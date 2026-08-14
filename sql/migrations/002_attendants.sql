-- ────────────────────────────────────────────────────────────────────────────
-- Migration: attendants
-- Atendentes / afiliados aprovados. Usado pelo filtro de afiliados no
-- /api/webhook/payt: postbacks vindos de afiliados que NÃO estão nesta
-- tabela são ignorados (return early com `ignored: foreign_affiliate`).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.attendants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,        -- normalizado lowercase no caller
  name       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attendants_active_idx ON public.attendants(is_active);

REVOKE ALL ON TABLE public.attendants FROM anon;
GRANT SELECT ON TABLE public.attendants TO authenticated;
GRANT ALL    ON TABLE public.attendants TO service_role;

ALTER TABLE public.attendants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read attendants"
  ON public.attendants FOR SELECT TO authenticated USING (true);
