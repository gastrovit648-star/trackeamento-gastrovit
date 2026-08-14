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
