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
