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
