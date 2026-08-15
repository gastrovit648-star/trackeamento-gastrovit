-- ═══════════════════════════════════════════════════════════════════════════
-- BOOTSTRAP ÚNICO — lumivitta-tracking (base Supabase NOVA)
--
-- Concatenação, na ordem de aplicação, de:
--   schema.sql (= migrations 001-006), 007, 008, 009, 010, 011,
--   012_webhook_log, 013_app_settings, 013_purchases_source_luminar, 014.
--   (012_ad_accounts_currency omitida: coluna já consolidada no schema.)
--
-- PRÉ-REQUISITO: habilitar a extensão pg_cron no dashboard
--   (Database → Extensions → pg_cron) ANTES de rodar.
--
-- Rodar UMA VEZ SÓ, num paste único no SQL Editor. Base já existente NÃO deve
-- rodar este arquivo — usar as migrations individuais.
-- ═══════════════════════════════════════════════════════════════════════════



-- ╔═══ ARQUIVO: schema.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- lumivitta-tracking — schema inicial consolidado
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


-- ╔═══ ARQUIVO: 007_events_log_ttl_partial.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: TTL parcial em events_log
-- Estratégia: zerar payload_meta e response_meta em rows com
-- created_at < now() - 14 days. NÃO deleta linha — preserva id, phone,
-- event_name, pixel_id que continuam alimentando o dashboard.
--
-- NOTA MVCC: PostgreSQL UPDATE não devolve espaço pro filesystem. Pra ver
-- o tamanho cair de fato, rodar manualmente após esta migration:
--   VACUUM (FULL, ANALYZE) events_log;
-- (trava a tabela — rodar em janela de baixo tráfego.)
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Função de saúde (idempotente) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.events_log_storage_health()
RETURNS TABLE (
  total_size_mb     NUMERIC,
  total_size_bytes  BIGINT,
  total_rows        BIGINT,
  rows_with_payload BIGINT,
  rows_zeroed       BIGINT,
  last_cron_run     TIMESTAMPTZ,
  last_cron_status  TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_last_run    TIMESTAMPTZ;
  v_last_status TEXT;
BEGIN
  BEGIN
    EXECUTE
      'SELECT max(start_time) FROM cron.job_run_details
        WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = $1)'
      INTO v_last_run USING 'events_log_ttl_partial';
    EXECUTE
      'SELECT status FROM cron.job_run_details
        WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = $1)
        ORDER BY start_time DESC LIMIT 1'
      INTO v_last_status USING 'events_log_ttl_partial';
  EXCEPTION WHEN OTHERS THEN
    v_last_run    := NULL;
    v_last_status := NULL;
  END;

  RETURN QUERY
  SELECT
    round(pg_total_relation_size('public.events_log') / 1024.0 / 1024.0, 2),
    pg_total_relation_size('public.events_log'),
    (SELECT count(*) FROM public.events_log),
    (SELECT count(*) FROM public.events_log
       WHERE payload_meta IS NOT NULL OR response_meta IS NOT NULL),
    (SELECT count(*) FROM public.events_log
       WHERE created_at < now() - interval '14 days'
         AND payload_meta IS NULL AND response_meta IS NULL),
    v_last_run,
    v_last_status;
END $$;

-- ── 2. UPDATE inicial em batches de 10k ────────────────────────────────────
DO $$
DECLARE
  size_before   BIGINT;
  size_after    BIGINT;
  total_rows    BIGINT;
  eligible_rows BIGINT;
  updated_rows  BIGINT := 0;
  batch_updated BIGINT;
BEGIN
  SELECT pg_total_relation_size('public.events_log') INTO size_before;
  SELECT count(*) FROM public.events_log INTO total_rows;
  SELECT count(*) FROM public.events_log
    WHERE created_at < now() - interval '14 days'
      AND (payload_meta IS NOT NULL OR response_meta IS NOT NULL)
    INTO eligible_rows;

  RAISE NOTICE 'events_log size BEFORE: % bytes (% MB)',
    size_before, round(size_before / 1024.0 / 1024.0, 2);
  RAISE NOTICE 'total rows: %', total_rows;
  RAISE NOTICE 'eligible rows (>14d com JSONB preenchido): %', eligible_rows;

  LOOP
    WITH batch AS (
      SELECT id FROM public.events_log
        WHERE created_at < now() - interval '14 days'
          AND (payload_meta IS NOT NULL OR response_meta IS NOT NULL)
        LIMIT 10000
    )
    UPDATE public.events_log e
       SET payload_meta  = NULL,
           response_meta = NULL
      FROM batch
     WHERE e.id = batch.id;

    GET DIAGNOSTICS batch_updated = ROW_COUNT;
    updated_rows := updated_rows + batch_updated;
    RAISE NOTICE 'batch updated: % (acumulado: %/%)',
      batch_updated, updated_rows, eligible_rows;
    EXIT WHEN batch_updated = 0;
  END LOOP;

  SELECT pg_total_relation_size('public.events_log') INTO size_after;
  RAISE NOTICE '── concluído. % rows zeradas ──', updated_rows;
  RAISE NOTICE 'size AFTER (sem VACUUM FULL, MVCC ainda segura espaço): % bytes (% MB)',
    size_after, round(size_after / 1024.0 / 1024.0, 2);
  RAISE NOTICE 'Pra liberar espaço pro filesystem rode: VACUUM (FULL, ANALYZE) events_log;';
END $$;

-- ── 3. Snapshot pós-migration ──────────────────────────────────────────────
SELECT * FROM public.events_log_storage_health();


-- ╔═══ ARQUIVO: 008_events_log_ttl_cron.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: agenda execução diária do TTL parcial em events_log.
--
-- Pré-requisito: pg_cron habilitado no Supabase. Se CREATE EXTENSION falhar
-- por permissão, habilitar via dashboard (Database → Extensions → pg_cron)
-- e rodar esta migration de novo — tudo aqui é idempotente.
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Worker function chamada pelo cron ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.events_log_ttl_partial_run()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  batch_updated BIGINT;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM public.events_log
        WHERE created_at < now() - interval '14 days'
          AND (payload_meta IS NOT NULL OR response_meta IS NOT NULL)
        LIMIT 10000
    )
    UPDATE public.events_log e
       SET payload_meta  = NULL,
           response_meta = NULL
      FROM batch
     WHERE e.id = batch.id;

    GET DIAGNOSTICS batch_updated = ROW_COUNT;
    EXIT WHEN batch_updated = 0;
  END LOOP;
END $$;

-- ── Agendamento (idempotente: desagenda se existir, reagenda) ──────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'events_log_ttl_partial') THEN
    PERFORM cron.unschedule('events_log_ttl_partial');
  END IF;
END $$;

SELECT cron.schedule(
  'events_log_ttl_partial',
  '0 3 * * *',  -- diário às 03:00 UTC (= 00:00 BRT)
  'SELECT public.events_log_ttl_partial_run()'
);

-- ── Verificação ────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, command, active
  FROM cron.job
 WHERE jobname = 'events_log_ttl_partial';


-- ╔═══ ARQUIVO: 009_purchases_attribution.sql ═══╗

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


-- ╔═══ ARQUIVO: 010_pixels_multi_send.sql ═══╗

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


-- ╔═══ ARQUIVO: 011_manual_events.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: produtos + coluna source em purchases (eventos manuais)
--
-- Motivação: permitir registro de vendas que não passam pelo gateway Payt
-- (vendas presenciais, manuais, ajustes). Novo módulo /dashboard/eventos-manuais
-- usa essas tabelas + nova rota /api/manual-purchase que dispara CAPI fan-out
-- igual o webhook Payt.
--
-- products: catálogo simples (id, nome, valor padrão, ativo).
-- purchases.source: discrimina origem ('payt' vs 'manual') pra filtragem
-- na listagem de vendas. Default 'payt' preserva semântica das vendas
-- existentes sem precisar backfill.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Tabela products ──────────────────────────────────────────────────────
CREATE TABLE public.products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  value       NUMERIC(10,2) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX products_active_idx ON public.products(is_active) WHERE is_active = TRUE;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

REVOKE ALL ON TABLE public.products FROM anon;
GRANT SELECT ON TABLE public.products TO authenticated;
GRANT ALL    ON TABLE public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read products"
  ON public.products FOR SELECT TO authenticated USING (true);

-- ── 2) Coluna source em purchases ───────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'payt'
    CHECK (source IN ('payt', 'manual'));

CREATE INDEX IF NOT EXISTS purchases_source_idx ON public.purchases(source);


-- ╔═══ ARQUIVO: 012_webhook_log.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: webhook_log
--
-- Motivação: o webhook de vendas (Payt + Luminar-pay) rejeita vários payloads
-- ANTES de gravar qualquer coisa em `purchases`/`events_log` (token inválido,
-- sem transaction_id, afiliado externo, status desconhecido). Quando uma
-- plataforma diz "enviei o webhook" mas a venda não aparece, não havia rastro
-- no banco — só nos runtime logs da Vercel.
--
-- Esta tabela grava TODO POST recebido logo na entrada do endpoint, antes dos
-- filtros, com payload cru + motivo do desfecho. Vira a fonte de auditoria
-- "últimos webhooks recebidos".
--
-- TTL: linhas com mais de 30 dias são apagadas por cron diário (mesmo padrão
-- do events_log, migration 008). Aqui apagamos a linha inteira (o valor está
-- no payload cru, que não faz sentido manter pra sempre).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.webhook_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         TEXT,                      -- 'payt' | 'luminar-pay' | 'unknown'
  endpoint       TEXT NOT NULL,             -- ex: '/api/webhook/payt'
  outcome        TEXT NOT NULL,             -- 'accepted' | 'rejected'
  reason         TEXT,                      -- 'approved' | 'unauthorized' | 'no_transaction_id' | 'foreign_affiliate' | 'unknown_status' | 'status_only:refunded' | 'deduped' | 'parse_error' | 'error'
  http_status    INTEGER NOT NULL,          -- código HTTP devolvido ao gateway
  transaction_id TEXT,                      -- quando extraível do payload
  payload        JSONB,                     -- payload cru recebido ({ raw: "..." } se não-JSON)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_log_created_at_idx     ON public.webhook_log(created_at DESC);
CREATE INDEX webhook_log_source_idx         ON public.webhook_log(source);
CREATE INDEX webhook_log_outcome_idx        ON public.webhook_log(outcome);
CREATE INDEX webhook_log_transaction_id_idx ON public.webhook_log(transaction_id);

-- ── GRANTs (padrão do projeto) ─────────────────────────────────────────────
REVOKE ALL ON TABLE public.webhook_log FROM anon;
GRANT SELECT ON TABLE public.webhook_log TO authenticated;
GRANT ALL    ON TABLE public.webhook_log TO service_role;

ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read webhook_log"
  ON public.webhook_log FOR SELECT TO authenticated USING (true);

-- ── TTL: apaga linhas > 30 dias via cron diário ────────────────────────────
-- Pré-requisito: pg_cron (já habilitado pela migration 008). Idempotente.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.webhook_log_ttl_run()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  batch_deleted BIGINT;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM public.webhook_log
        WHERE created_at < now() - interval '30 days'
        LIMIT 10000
    )
    DELETE FROM public.webhook_log w
      USING batch
     WHERE w.id = batch.id;

    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    EXIT WHEN batch_deleted = 0;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook_log_ttl') THEN
    PERFORM cron.unschedule('webhook_log_ttl');
  END IF;
END $$;

SELECT cron.schedule(
  'webhook_log_ttl',
  '15 3 * * *',  -- diário às 03:15 UTC (= 00:15 BRT), logo após o TTL do events_log
  'SELECT public.webhook_log_ttl_run()'
);

-- ── Verificação ────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, command, active
  FROM cron.job
 WHERE jobname = 'webhook_log_ttl';


-- ╔═══ ARQUIVO: 013_app_settings.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: app_settings
-- Tabela key-value genérica para configurações operacionais editáveis pela UI
-- (sem precisar de env var / redeploy). Primeiro uso: cotação USD→BRL.
--
-- value é JSONB pra acomodar formatos diferentes por chave. Chave atual:
--   'usd_brl_rate' → { "mode": "auto" | "manual", "manual_rate": number | null }
--     - mode=auto   → cotação buscada ao vivo na AwesomeAPI (comportamento legado)
--     - mode=manual → usa manual_rate fixo (ex.: travar 5.50 num período)
--
-- Lida por src/lib/exchange-rate.ts (getUsdToBrlRate) via service_role.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
-- Config operacional: nada de público. Leitura via authenticated (a página de
-- configurações renderiza no servidor mas pode evoluir); escrita só service_role.
REVOKE ALL ON TABLE public.app_settings FROM anon;
GRANT SELECT ON TABLE public.app_settings TO authenticated;
GRANT ALL    ON TABLE public.app_settings TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read app_settings"
  ON public.app_settings FOR SELECT TO authenticated USING (true);

-- ── Seed: cotação em modo automático (preserva comportamento atual) ─────────
INSERT INTO public.app_settings (key, value)
VALUES ('usd_brl_rate', '{"mode":"auto","manual_rate":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ╔═══ ARQUIVO: 013_purchases_source_luminar.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: adiciona 'luminar-pay' como origem (source) de purchases
--
-- Até aqui o webhook de vendas gravava TODA venda como source='payt' (o default
-- da coluna, migration 011), mesmo as que vêm da Luminar-pay. A Luminar é
-- identificada por integration_key/seller_id == 'luminar-pay' e posta no mesmo
-- endpoint da Payt.
--
-- Esta migration:
--   1. Amplia o CHECK de source pra aceitar 'luminar-pay'.
--   2. Reclassifica as vendas já gravadas cujo raw_webhook indica Luminar.
--
-- O webhook passa a gravar source corretamente daqui pra frente (route.ts).
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Amplia o CHECK constraint ────────────────────────────────────────────
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('payt', 'manual', 'luminar-pay'));

-- ── 2) Backfill das vendas Luminar já existentes ────────────────────────────
-- Identifica pelo payload cru salvo em raw_webhook (integration_key/seller_id).
UPDATE public.purchases
   SET source = 'luminar-pay'
 WHERE source = 'payt'
   AND (
        raw_webhook->>'integration_key' = 'luminar-pay'
     OR raw_webhook->>'seller_id'        = 'luminar-pay'
   );

-- ── Verificação ────────────────────────────────────────────────────────────
SELECT source, count(*) FROM public.purchases GROUP BY source ORDER BY source;


-- ╔═══ ARQUIVO: 014_usd_brl_rates.sql ═══╗

-- ────────────────────────────────────────────────────────────────────────────
-- Migration: usd_brl_rates
-- Cotação USD→BRL travada POR DIA, preenchida manualmente pelo dashboard.
--
-- Contexto: o Meta NÃO expõe na API a taxa de câmbio que ele usa pra faturar
-- contas em USD (o insights devolve spend já na moeda da conta, sem o câmbio).
-- Então a cotação de cada dia é informada à mão em /dashboard/configuracoes e
-- o dashboard converte o gasto de cada dia pela taxa daquela data.
--
-- Precedência de cotação (ver src/lib/exchange-rate.ts e queries.ts):
--   1. usd_brl_rates[data]          ← esta tabela (override por dia)
--   2. app_settings.usd_brl_rate    ← fallback global (manual fixo ou auto live)
--
-- `date` é a data no fuso da conta (YYYY-MM-DD), batendo com date_start do
-- insights do Meta. Conexão direta (service_role) não é afetada pela Data API.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usd_brl_rates (
  date       DATE PRIMARY KEY,
  rate       NUMERIC(10,4) NOT NULL CHECK (rate > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER usd_brl_rates_updated_at
  BEFORE UPDATE ON public.usd_brl_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── GRANTs (padrão CLAUDE.md) ──────────────────────────────────────────────
REVOKE ALL ON TABLE public.usd_brl_rates FROM anon;
GRANT SELECT ON TABLE public.usd_brl_rates TO authenticated;
GRANT ALL    ON TABLE public.usd_brl_rates TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.usd_brl_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read usd_brl_rates"
  ON public.usd_brl_rates FOR SELECT TO authenticated USING (true);

-- ════════════════════════════════════════════════════════════════════════════
-- Migrations 015–019 (append pra bootstrap COMPLETO). Idempotentes; os backfills
-- de 015/016/017 viram no-op em banco novo (sem linhas). Ordem importa: as CHECK
-- de status/source de 018 substituem as anteriores (versao final e a correta).
-- ════════════════════════════════════════════════════════════════════════════

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 015_purchases_payment_method_refused.sql
-- └───────────────────────────────────────────────────────────────────────────
-- ────────────────────────────────────────────────────────────────────────────
-- Migration: payment_method em purchases + status 'refused'
--
-- Motivação: o dashboard passa a mostrar (a) o faturamento dividido por
-- plataforma × método de pagamento (Luminar cartão/boleto/PIX, Payt etc.) e
-- (b) métricas de transações não-aprovadas: "Boleto gerado", "PIX gerado"
-- (payloads Luminar com payment_status=waiting_payment) e "Cartão recusado"
-- (payment_status=refused). Até aqui o webhook DESCARTAVA waiting_payment e
-- refused (caíam em unknown_status) e não guardava o método de pagamento.
--
--   1. Coluna purchases.payment_method ('credit_card' | 'boleto' | 'pix' |
--      NULL). Sem CHECK de valores: a normalização acontece no webhook
--      (parsePayt) e novos métodos não podem quebrar o insert.
--   2. Amplia o CHECK de status pra aceitar 'refused'.
--   3. Backfill de payment_method a partir do raw_webhook das vendas já
--      gravadas (transaction.payment_method — shape Luminar/Payt).
--
-- Idempotente: pode re-rodar sem efeito colateral.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Coluna payment_method ────────────────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- ── 2) CHECK de status aceita 'refused' ─────────────────────────────────────
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('approved', 'refunded', 'pending', 'refused'));

-- ── 3) Backfill a partir do raw_webhook ─────────────────────────────────────
-- Mesma normalização do parsePayt (route.ts): pix / boleto / cartão.
UPDATE public.purchases
   SET payment_method = CASE
     WHEN method_raw LIKE '%pix%'                                    THEN 'pix'
     WHEN method_raw LIKE '%boleto%' OR method_raw LIKE '%billet%'
       OR method_raw LIKE '%bank_slip%'                              THEN 'boleto'
     WHEN method_raw LIKE '%card%'   OR method_raw LIKE '%credit%'
       OR method_raw LIKE '%cartao%' OR method_raw LIKE '%cartão%'   THEN 'credit_card'
     ELSE NULL
   END
  FROM (
    SELECT id AS pid,
           lower(coalesce(
             raw_webhook->'transaction'->>'payment_method',
             raw_webhook->>'payment_method',
             raw_webhook->'payment'->>'method',
             ''
           )) AS method_raw
      FROM public.purchases
     WHERE payment_method IS NULL AND raw_webhook IS NOT NULL
  ) src
 WHERE id = src.pid;

-- ── Verificação ─────────────────────────────────────────────────────────────
SELECT payment_method, status, count(*)
  FROM public.purchases
 GROUP BY payment_method, status
 ORDER BY payment_method NULLS LAST, status;

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 016_purchases_approved_at.sql
-- └───────────────────────────────────────────────────────────────────────────
-- 016_purchases_approved_at.sql
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO. O webhook passa a incluir
-- `approved_at` no upsert de aprovação; se a coluna ainda não existir,
-- o PostgREST rejeita o upsert inteiro (coluna inexistente) e a venda
-- não é gravada.
--
-- Contexto: vendas aprovadas eram contadas no dashboard pelo dia da
-- CRIAÇÃO da transação (created_at). Boleto/PIX entra como pending no
-- dia da geração e o upsert de aprovação só muda o status — o created_at
-- não muda. Resultado: boleto gerado dia X e pago dia Y aparecia como
-- venda do dia X, divergindo do evento Purchase do CAPI (enviado em Y).
--
-- `approved_at` registra o momento da APROVAÇÃO (setado pelo webhook no
-- postback de status approved, e no lançamento manual). Linhas legadas
-- recebem backfill approved_at = created_at (melhor aproximação
-- disponível). Refund NÃO altera approved_at — a venda continua contando
-- no dia em que foi aprovada.

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Backfill do legado: vendas já aprovadas/reembolsadas assumem a data de
-- criação como data de aprovação (não temos a data real do pagamento).
UPDATE public.purchases
   SET approved_at = created_at
 WHERE approved_at IS NULL
   AND status IN ('approved', 'refunded');

CREATE INDEX IF NOT EXISTS purchases_approved_at_idx
  ON public.purchases(approved_at DESC);

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 017_purchases_approved_at_recarimbo.sql
-- └───────────────────────────────────────────────────────────────────────────
-- 017_purchases_approved_at_recarimbo.sql
--
-- Correção pós-016 — aplicar DEPOIS da 016.
--
-- O backfill da 016 marcou vendas legadas com approved_at = created_at
-- (dia da GERAÇÃO da transação — pra boleto/PIX pago depois, é o dia
-- errado). Para as vendas que têm evento Purchase em events_log, o horário
-- real da aprovação é o momento do envio ao CAPI: o webhook insere em
-- events_log na MESMA requisição que processa a aprovação. Recarimba
-- approved_at com MIN(events_log.created_at) do evento correspondente
-- (purchases.meta_event_id == events_log.event_id; MIN porque o fan-out
-- multi-pixel grava N linhas com o mesmo event_id).
--
-- Idempotente: só toca linhas cujo approved_at ainda é exatamente igual ao
-- created_at (assinatura do backfill da 016 — o carimbo do webhook novo
-- nunca coincide ao microssegundo). Vendas sem linha em events_log (sem
-- pixel ativo no fan-out, ou linha já expirada pelo TTL da migration 008)
-- permanecem com o fallback created_at.

UPDATE public.purchases AS p
   SET approved_at = e.first_purchase_at
  FROM (
        SELECT event_id, MIN(created_at) AS first_purchase_at
          FROM public.events_log
         WHERE event_name = 'Purchase'
         GROUP BY event_id
       ) AS e
 WHERE p.meta_event_id = e.event_id
   AND p.status IN ('approved', 'refunded')
   AND p.approved_at = p.created_at;

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 018_purchases_scheduled.sql
-- └───────────────────────────────────────────────────────────────────────────
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

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 019_pixels_capi_mode.sql
-- └───────────────────────────────────────────────────────────────────────────
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

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 020 — MULTI-PROJETO (projects + project_id)
-- ════════════════════════════════════════════════════════════════════════════
-- Um projeto agrupa contas de anúncio, pixels e atendentes pra escopar o
-- dashboard por nicho/modalidade. Em base nova o "Geral" é criado e os backfills
-- viram no-op (sem linhas ainda). Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS projects_created_at_idx ON public.projects(created_at);

REVOKE ALL ON TABLE public.projects FROM anon;
GRANT SELECT ON TABLE public.projects TO authenticated;
GRANT ALL    ON TABLE public.projects TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read projects" ON public.projects;
CREATE POLICY "Authenticated read projects"
  ON public.projects FOR SELECT TO authenticated USING (true);

INSERT INTO public.projects (name)
SELECT 'Geral'
WHERE NOT EXISTS (SELECT 1 FROM public.projects);

ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.pixels      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.attendants  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);

CREATE INDEX IF NOT EXISTS ad_accounts_project_id_idx ON public.ad_accounts(project_id);
CREATE INDEX IF NOT EXISTS pixels_project_id_idx      ON public.pixels(project_id);
CREATE INDEX IF NOT EXISTS attendants_project_id_idx  ON public.attendants(project_id);

UPDATE public.ad_accounts SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1) WHERE project_id IS NULL;
UPDATE public.pixels      SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1) WHERE project_id IS NULL;
UPDATE public.attendants  SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1) WHERE project_id IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 021 — MULTI-PROJETO POR ENTIDADE (project_ids array)
-- ════════════════════════════════════════════════════════════════════════════
-- Uma conta/pixel/atendente pode pertencer a VÁRIOS projetos (conta compartilhada
-- entre projetos). Troca project_id (único) por project_ids (UUID[]). project_id
-- fica DEPRECADO (não é mais lido pelo código). Em base nova os backfills viram
-- no-op. Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE public.pixels      ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE public.attendants  ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS ad_accounts_project_ids_idx ON public.ad_accounts USING GIN (project_ids);
CREATE INDEX IF NOT EXISTS pixels_project_ids_idx      ON public.pixels      USING GIN (project_ids);
CREATE INDEX IF NOT EXISTS attendants_project_ids_idx  ON public.attendants  USING GIN (project_ids);

UPDATE public.ad_accounts SET project_ids = ARRAY[project_id] WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;
UPDATE public.pixels      SET project_ids = ARRAY[project_id] WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;
UPDATE public.attendants  SET project_ids = ARRAY[project_id] WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 022 — source 'braip' (webhook /api/webhook/braip)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('payt', 'manual', 'luminar-pay', 'skale', 'braip'));
