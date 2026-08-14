-- ────────────────────────────────────────────────────────────────────────────
-- Migration: purchases — atribuição persistida (campaign/adset/ad)
--
-- Motivação: até hoje a atribuição de venda → campanha era recalculada em
-- runtime via JOIN purchases.phone ↔ leads.phone. Isso causava bug de
-- time-windowing assimétrico: se o lead foi criado FORA do range do filtro
-- mas a venda DENTRO, a venda sumia de /dashboard/campanhas (totalRevenue
-- subestimado, vendas=0 mesmo com purchase aprovada visível em /vendas).
--
-- Solução: snapshot da atribuição no momento da venda. Webhook copia os
-- campos do lead (last-touch — leads.phone é UNIQUE, só existe 1 lead por
-- phone) pra purchases no momento do match. Histórico fica imutável mesmo
-- se o lead for atualizado depois (cliente cair em retargeting de outra
-- campanha).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill só preenche colunas NULL.
-- Pode re-rodar sem efeito colateral.
-- ────────────────────────────────────────────────────────────────────────────

-- ── ADD COLUMNS ─────────────────────────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS campaign_id   TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT,
  ADD COLUMN IF NOT EXISTS adset_id      TEXT,
  ADD COLUMN IF NOT EXISTS adset_name    TEXT,
  ADD COLUMN IF NOT EXISTS ad_id         TEXT,
  ADD COLUMN IF NOT EXISTS ad_name       TEXT,
  ADD COLUMN IF NOT EXISTS ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE SET NULL;

-- ── ÍNDICES p/ agregação em /dashboard/campanhas ────────────────────────────
CREATE INDEX IF NOT EXISTS purchases_campaign_idx   ON public.purchases(campaign_id);
CREATE INDEX IF NOT EXISTS purchases_adset_idx      ON public.purchases(adset_id);
CREATE INDEX IF NOT EXISTS purchases_ad_idx         ON public.purchases(ad_id);
CREATE INDEX IF NOT EXISTS purchases_ad_account_idx ON public.purchases(ad_account_id);

-- ── BACKFILL ─────────────────────────────────────────────────────────────────
-- Last-touch (= único toque, já que leads.phone é UNIQUE): copia estado
-- atual do lead pra cada purchase com phone matching.
--
-- WHERE p.campaign_id IS NULL → idempotente. Re-rodar não sobrescreve dados
-- já populados (ex: vendas novas que já chegaram com atribuição via webhook).
UPDATE public.purchases p
SET
  campaign_id   = l.campaign_id,
  campaign_name = l.campaign_name,
  adset_id      = l.adset_id,
  adset_name    = l.adset_name,
  ad_id         = l.ad_id,
  ad_name       = l.ad_name,
  ad_account_id = l.ad_account_id
FROM public.leads l
WHERE p.phone = l.phone
  AND p.campaign_id IS NULL;
