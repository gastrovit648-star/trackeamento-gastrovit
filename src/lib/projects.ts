import { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-projeto (migration 020). Um projeto agrupa contas de anúncio, pixels e
// atendentes — pra separar nichos/modalidades num dashboard só. O seletor da
// sidebar grava ?project=<id>; as queries escopam tudo pelas contas do projeto.
// ─────────────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  created_at: string;
}

/** Lista todos os projetos (seletor + tela de gestão), mais antigos primeiro. */
export async function getProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[projects] getProjects:", error);
    return [];
  }
  return (data ?? []) as Project[];
}

/**
 * Resolve o projeto ativo a partir do ?project= cru. Retorna null pra "todos os
 * projetos" (sem param, ou id inexistente — projeto apagado cai pra "todos").
 */
export function resolveProjectId(
  projects: Project[],
  raw?: string | null,
): string | null {
  if (!raw) return null;
  return projects.some(p => p.id === raw) ? raw : null;
}

/**
 * IDs das contas de anúncio de um projeto — o "escopo" que as queries de
 * leads/vendas usam (`projectAccountIds`). Inclui contas inativas de propósito:
 * dados históricos de uma conta desativada continuam no projeto dela.
 *
 * - projectId null  → null (visão "todos os projetos", sem escopo).
 * - projectId válido → array de ids (pode ser vazio: projeto sem contas → as
 *   queries mostram ZERO, via sentinela no scopeAccount).
 * - erro            → [] (falha fecha o escopo; nunca vaza dados de outro projeto).
 */
export async function getProjectAccountIds(
  supabase: SupabaseClient,
  projectId: string | null,
): Promise<string[] | null> {
  if (!projectId) return null;
  const { data, error } = await supabase
    .from("ad_accounts")
    .select("id")
    .contains("project_ids", [projectId]);  // conta pertence ao projeto (migration 021)
  if (error) {
    console.error("[projects] getProjectAccountIds:", error);
    return [];
  }
  return (data ?? []).map(a => (a as { id: string }).id);
}

/**
 * Atalho de página: resolve o ?project= cru em `{ projectId, projectAccountIds }`
 * de uma vez. Toda página do dashboard que escopa dados chama isto e repassa
 * `projectAccountIds` às queries (getOverviewMetrics/getLeadsList/etc.).
 */
export async function resolveProjectScope(
  supabase: SupabaseClient,
  rawProject?: string | null,
): Promise<{ projectId: string | null; projectAccountIds: string[] | null }> {
  const projects = await getProjects(supabase);
  const projectId = resolveProjectId(projects, rawProject);
  const projectAccountIds = await getProjectAccountIds(supabase, projectId);
  return { projectId, projectAccountIds };
}
