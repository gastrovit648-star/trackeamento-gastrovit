-- ────────────────────────────────────────────────────────────────────────────
-- ads-tracking — schema inicial consolidado
--
-- Aplicar este arquivo NUMA BASE NOVA equivale a aplicar migrations 001-006
-- em sequência. Pra TTL parcial de events_log + cron, rodar migrations
-- 007 e 008 separadamente (sql/migrations/).
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Trigger compartilhado de updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- ─── AD_ACCOUNTS ────────────────────────────────────────────────────────────
CREATE TABLE public.ad_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id        TEXT NOT NULL,
  account_id   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  access_token TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ad_accounts_active_idx ON public.ad_accounts(is_active);
CREATE TRIGGER ad_accounts_updated_at
  BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── ATTENDANTS ─────────────────────────────────────────────────────────────
CREATE TABLE public.attendants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX attendants_active_idx ON public.attendants(is_active);

-- ─── PIXELS ─────────────────────────────────────────────────────────────────
CREATE TABLE public.pixels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pixel_id     TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  name         TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX pixels_only_one_default
  ON public.pixels(is_default) WHERE is_default = TRUE;

-- ─── LEADS ──────────────────────────────────────────────────────────────────
CREATE TABLE public.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,
  phone_hash      TEXT,
  ctwa_clid       TEXT,
  source_id       TEXT,
  ad_account_id   UUID REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  pixel_id        UUID REFERENCES public.pixels(id)      ON DELETE SET NULL,
  campaign_id     TEXT,
  campaign_name   TEXT,
  adset_id        TEXT,
  adset_name      TEXT,
  ad_id           TEXT,
  ad_name         TEXT,
  raw_webhook     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX leads_ad_account_idx ON public.leads(ad_account_id);
CREATE INDEX leads_campaign_idx   ON public.leads(campaign_id);
CREATE INDEX leads_adset_idx      ON public.leads(adset_id);
CREATE INDEX leads_ad_idx         ON public.leads(ad_id);
CREATE INDEX leads_created_at_idx ON public.leads(created_at DESC);
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── PURCHASES ──────────────────────────────────────────────────────────────
CREATE TABLE public.purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   TEXT NOT NULL UNIQUE,
  phone            TEXT,
  phone_hash       TEXT,
  email            TEXT,
  email_hash       TEXT,
  first_name_hash  TEXT,
  last_name_hash   TEXT,
  product_name     TEXT,
  product_id       TEXT,
  value            NUMERIC(10,2) NOT NULL,
  commission_value NUMERIC(10,2),
  currency         TEXT NOT NULL DEFAULT 'BRL',
  status           TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'refunded', 'pending')),
  affiliate_email  TEXT,
  matched_lead     BOOLEAN NOT NULL DEFAULT FALSE,
  meta_event_id    TEXT,
  response_meta    JSONB,
  raw_webhook      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX purchases_phone_idx      ON public.purchases(phone);
CREATE INDEX purchases_status_idx     ON public.purchases(status);
CREATE INDEX purchases_created_at_idx ON public.purchases(created_at DESC);
CREATE INDEX purchases_affiliate_idx  ON public.purchases(affiliate_email);

-- ─── EVENTS_LOG ─────────────────────────────────────────────────────────────
CREATE TABLE public.events_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT,
  event_name    TEXT NOT NULL,
  event_id      TEXT NOT NULL UNIQUE,
  pixel_id      TEXT,
  payload_meta  JSONB,
  response_meta JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX events_log_phone_idx      ON public.events_log(phone);
CREATE INDEX events_log_event_name_idx ON public.events_log(event_name);
CREATE INDEX events_log_created_at_idx ON public.events_log(created_at DESC);

-- ─── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
REVOKE ALL ON TABLE public.ad_accounts FROM anon;
REVOKE ALL ON TABLE public.attendants  FROM anon;
REVOKE ALL ON TABLE public.pixels      FROM anon;
REVOKE ALL ON TABLE public.leads       FROM anon;
REVOKE ALL ON TABLE public.purchases   FROM anon;
REVOKE ALL ON TABLE public.events_log  FROM anon;

GRANT SELECT ON TABLE public.ad_accounts TO authenticated;
GRANT SELECT ON TABLE public.attendants  TO authenticated;
GRANT SELECT ON TABLE public.pixels      TO authenticated;
GRANT SELECT ON TABLE public.leads       TO authenticated;
GRANT SELECT ON TABLE public.purchases   TO authenticated;
GRANT SELECT ON TABLE public.events_log  TO authenticated;

GRANT ALL ON TABLE public.ad_accounts TO service_role;
GRANT ALL ON TABLE public.attendants  TO service_role;
GRANT ALL ON TABLE public.pixels      TO service_role;
GRANT ALL ON TABLE public.leads       TO service_role;
GRANT ALL ON TABLE public.purchases   TO service_role;
GRANT ALL ON TABLE public.events_log  TO service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pixels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_log  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ad_accounts"
  ON public.ad_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read attendants"
  ON public.attendants  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read pixels"
  ON public.pixels      FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read leads"
  ON public.leads       FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read purchases"
  ON public.purchases   FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read events_log"
  ON public.events_log  FOR SELECT TO authenticated USING (true);
