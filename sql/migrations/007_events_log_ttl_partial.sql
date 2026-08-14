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
