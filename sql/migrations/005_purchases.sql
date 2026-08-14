-- ────────────────────────────────────────────────────────────────────────────
-- Migration: purchases
-- Compras vindas do postback da Payt. Match com lead é feito por phone
-- (normalizado pra 13 dígitos). meta_event_id é determinístico via
-- sha256("purchase:"+transaction_id) → idempotência nativa no Meta CAPI
-- mesmo se o webhook executar mais de uma vez.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   TEXT NOT NULL UNIQUE,
  phone            TEXT,                                  -- normalizado, FK lógico → leads.phone
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
  affiliate_email  TEXT,                                  -- email do afiliado Payt (null = venda direta)
  matched_lead     BOOLEAN NOT NULL DEFAULT FALSE,
  meta_event_id    TEXT,                                  -- sha256("purchase:"+transaction_id)
  response_meta    JSONB,                                 -- resposta do Meta CAPI
  raw_webhook      JSONB,                                 -- payload bruto da Payt
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchases_phone_idx      ON public.purchases(phone);
CREATE INDEX purchases_status_idx     ON public.purchases(status);
CREATE INDEX purchases_created_at_idx ON public.purchases(created_at DESC);
CREATE INDEX purchases_affiliate_idx  ON public.purchases(affiliate_email);

REVOKE ALL ON TABLE public.purchases FROM anon;
GRANT SELECT ON TABLE public.purchases TO authenticated;
GRANT ALL    ON TABLE public.purchases TO service_role;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read purchases"
  ON public.purchases FOR SELECT TO authenticated USING (true);
