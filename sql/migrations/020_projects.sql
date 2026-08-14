-- 020_projects.sql
--
-- Camada de MULTI-PROJETO. Um projeto agrupa contas de anúncio, pixels e
-- atendentes — pra o cliente separar nichos/modalidades (after-pay vs
-- antecipado) num dashboard só, trocando pelo seletor. O escopo do dashboard
-- filtra tudo pelas contas de anúncio do projeto (leads/vendas herdam a conta).
--
-- ⚠️ APLICAR ANTES DO DEPLOY DO CÓDIGO. O código passa a ler/gravar project_id.
--
--   1. Tabela projects (+ GRANTs + RLS, padrão CLAUDE.md).
--   2. Projeto "Geral" default (só se ainda não houver projetos).
--   3. project_id em ad_accounts, pixels, attendants (nullable → backfill Geral).
--
-- Idempotente.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) Tabela projects ──────────────────────────────────────────────────────
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

-- ── 2) Projeto default "Geral" (só se a tabela estiver vazia) ────────────────
INSERT INTO public.projects (name)
SELECT 'Geral'
WHERE NOT EXISTS (SELECT 1 FROM public.projects);

-- ── 3) project_id nas entidades + backfill pro Geral ────────────────────────
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.pixels      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.attendants  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);

CREATE INDEX IF NOT EXISTS ad_accounts_project_id_idx ON public.ad_accounts(project_id);
CREATE INDEX IF NOT EXISTS pixels_project_id_idx      ON public.pixels(project_id);
CREATE INDEX IF NOT EXISTS attendants_project_id_idx  ON public.attendants(project_id);

-- Backfill: tudo que está sem projeto vai pro primeiro projeto (Geral).
UPDATE public.ad_accounts
   SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1)
 WHERE project_id IS NULL;
UPDATE public.pixels
   SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1)
 WHERE project_id IS NULL;
UPDATE public.attendants
   SET project_id = (SELECT id FROM public.projects ORDER BY created_at, id LIMIT 1)
 WHERE project_id IS NULL;
