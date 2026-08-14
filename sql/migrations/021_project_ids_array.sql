-- 021_project_ids_array.sql
--
-- Multi-projeto POR ENTIDADE. A migration 020 amarrava cada conta/pixel/atendente
-- a UM projeto (`project_id`). Agora uma MESMA conta/pixel/atendente pode
-- pertencer a VÁRIOS projetos — pra dois projetos compartilharem a mesma conta de
-- anúncio (a conta aparece cheia em cada projeto, com sobreposição nos totais).
--
-- Troca `project_id` (UUID único) por `project_ids` (UUID[]). O `project_id`
-- antigo fica como coluna DEPRECADA (não é mais lida/escrita pelo código) — não
-- dropamos pra não abrir janela de quebra com o deploy anterior. Pode ser
-- removida num cleanup futuro.
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO. O código passa a ler/gravar project_ids.
--
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) project_ids em cada entidade ─────────────────────────────────────────
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE public.pixels      ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE public.attendants  ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';

-- Índices GIN pra busca por conteúdo (project_ids @> ARRAY[x] / && ).
CREATE INDEX IF NOT EXISTS ad_accounts_project_ids_idx ON public.ad_accounts USING GIN (project_ids);
CREATE INDEX IF NOT EXISTS pixels_project_ids_idx      ON public.pixels      USING GIN (project_ids);
CREATE INDEX IF NOT EXISTS attendants_project_ids_idx  ON public.attendants  USING GIN (project_ids);

-- ── 2) Backfill do project_id (single) pro array ────────────────────────────
-- Só preenche linhas cujo array ainda está vazio (idempotente): quem já tem
-- project_id vira {project_id}; quem não tem fica {} (só aparece em "Todos").
UPDATE public.ad_accounts
   SET project_ids = ARRAY[project_id]
 WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;
UPDATE public.pixels
   SET project_ids = ARRAY[project_id]
 WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;
UPDATE public.attendants
   SET project_ids = ARRAY[project_id]
 WHERE project_id IS NOT NULL AND cardinality(project_ids) = 0;
