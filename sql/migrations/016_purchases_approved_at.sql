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
