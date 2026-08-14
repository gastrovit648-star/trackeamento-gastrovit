-- ────────────────────────────────────────────────────────────────────────────
-- Migration: pixels
-- Pixels do Meta que recebem o Purchase via CAPI quando uma compra Payt
-- bate. O webhook payt resolve o pixel: (a) lead.pixel_id se o lead foi
-- matched por telefone; (b) pixel com is_default=true caso contrário.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.pixels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pixel_id     TEXT NOT NULL UNIQUE,     -- ID numérico do pixel no Meta
  access_token TEXT NOT NULL,            -- token CAPI deste pixel
  name         TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No máximo 1 pixel default. Partial unique index — multiplas rows com
-- is_default=false são permitidas.
CREATE UNIQUE INDEX pixels_only_one_default
  ON public.pixels(is_default) WHERE is_default = TRUE;

REVOKE ALL ON TABLE public.pixels FROM anon;
GRANT SELECT ON TABLE public.pixels TO authenticated;
GRANT ALL    ON TABLE public.pixels TO service_role;

ALTER TABLE public.pixels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pixels"
  ON public.pixels FOR SELECT TO authenticated USING (true);
