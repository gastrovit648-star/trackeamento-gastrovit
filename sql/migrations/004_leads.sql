-- ────────────────────────────────────────────────────────────────────────────
-- Migration: leads
-- Lead = primeira mensagem vinda do anúncio CTWA, capturada pelo webhook
-- DataCrazy. Identificador é phone (DDI 55 + DDD + 9 + 8 dígitos = 13).
-- Joga "for free" o contexto do anúncio resolvido via Meta Graph API
-- a partir do source_id, pra evitar consultas adicionais depois.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,         -- 13 dígitos normalizados
  phone_hash      TEXT,                         -- sha256(phone) pra CAPI
  ctwa_clid       TEXT,                         -- Click-to-WhatsApp Click ID
  source_id       TEXT,                         -- ID retornado pelo Meta (ad/adset/campaign)
  ad_account_id   UUID REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  pixel_id        UUID REFERENCES public.pixels(id)      ON DELETE SET NULL,
  campaign_id     TEXT,
  campaign_name   TEXT,
  adset_id        TEXT,
  adset_name      TEXT,
  ad_id           TEXT,
  ad_name         TEXT,
  raw_webhook     JSONB,                        -- payload bruto do DataCrazy
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

REVOKE ALL ON TABLE public.leads FROM anon;
GRANT SELECT ON TABLE public.leads TO authenticated;
GRANT ALL    ON TABLE public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read leads"
  ON public.leads FOR SELECT TO authenticated USING (true);
