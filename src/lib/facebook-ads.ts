/**
 * Wrapper sobre Meta Graph API v19 para insights de campanhas e resolução
 * de contexto de anúncio (source_id → campaign/adset/ad).
 *
 * Multi-conta: todas as funções recebem `account` como param em vez de ler
 * env vars. Caller (queries.ts / webhook DataCrazy) faz lookup em ad_accounts.
 *
 * Cache: `revalidate: 60` em todos os fetches → no máximo 1 hit/min por
 * (conta, URL). Tag por conta permite invalidação cirúrgica via revalidateTag.
 */

const GRAPH_API_VERSION = "v19.0";

export interface AdAccount {
  account_id: string;     // sem prefixo "act_"
  access_token: string;
}

export interface AdInsight {
  campaign_id: string;
  campaign_name: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend: string;
  clicks: string;
  date_start?: string;
  date_stop?: string;
}

export async function fetchCampaignInsights(
  account: AdAccount,
  dateRange: { since: string; until: string },
  level: "campaign" | "adset" | "ad" = "campaign",
  timeIncrement?: string
): Promise<AdInsight[]> {
  if (!account.account_id || !account.access_token) return [];

  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,clicks,date_start,date_stop";
  const params = new URLSearchParams({
    fields,
    level,
    time_range: JSON.stringify(dateRange),
    access_token: account.access_token,
    limit: "500",
  });
  if (timeIncrement) params.set("time_increment", timeIncrement);

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${account.account_id}/insights?${params}`;

  try {
    const res = await fetch(url, {
      next: {
        revalidate: 60,
        tags: ["meta-insights", `meta-insights-${account.account_id}`],
      },
    } as RequestInit);
    const data = await res.json();
    if (data.error) {
      console.error(`[facebook-ads] insights ${account.account_id}:`, data.error.message);
      return [];
    }
    return data.data ?? [];
  } catch (err) {
    console.error(`[facebook-ads] insights ${account.account_id}:`, err);
    return [];
  }
}

export async function getTotalAdSpend(
  account: AdAccount,
  dateRange: { since: string; until: string }
): Promise<number> {
  const insights = await fetchCampaignInsights(account, dateRange, "campaign");
  return insights.reduce((sum, i) => sum + parseFloat(i.spend || "0"), 0);
}

export interface AdHierarchyAd {
  id: string;
  name: string;
  spend: number;
  clicks: number;
}
export interface AdHierarchyAdset {
  id: string;
  name: string;
  spend: number;
  clicks: number;
  ads: AdHierarchyAd[];
}
export interface AdHierarchy {
  id: string;
  name: string;
  spend: number;
  clicks: number;
  adsets: AdHierarchyAdset[];
}

export async function fetchFullHierarchy(
  account: AdAccount,
  dateRange: { since: string; until: string }
): Promise<AdHierarchy[]> {
  const [campaignData, adsetData, adData] = await Promise.all([
    fetchCampaignInsights(account, dateRange, "campaign"),
    fetchCampaignInsights(account, dateRange, "adset"),
    fetchCampaignInsights(account, dateRange, "ad"),
  ]);

  const campaigns = new Map<string, AdHierarchy>();

  for (const c of campaignData) {
    campaigns.set(c.campaign_id, {
      id: c.campaign_id,
      name: c.campaign_name,
      spend: parseFloat(c.spend || "0"),
      clicks: parseInt(c.clicks || "0"),
      adsets: [],
    });
  }

  const adsetMap = new Map<string, AdHierarchyAdset>();
  for (const a of adsetData) {
    const adset: AdHierarchyAdset = {
      id: a.adset_id || "",
      name: a.adset_name || "",
      spend: parseFloat(a.spend || "0"),
      clicks: parseInt(a.clicks || "0"),
      ads: [],
    };
    adsetMap.set(adset.id, adset);
    const campaign = campaigns.get(a.campaign_id);
    if (campaign) campaign.adsets.push(adset);
  }

  for (const a of adData) {
    const ad: AdHierarchyAd = {
      id: a.ad_id || "",
      name: a.ad_name || "",
      spend: parseFloat(a.spend || "0"),
      clicks: parseInt(a.clicks || "0"),
    };
    const adset = adsetMap.get(a.adset_id || "");
    if (adset) adset.ads.push(ad);
  }

  return Array.from(campaigns.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAccountAds — anúncios ESTRUTURAIS do gerenciador (independe de gasto).
//
// /insights só devolve entidades com spend > 0 no período, então anúncios sem
// gasto (e sem lead/venda) não aparecem na árvore. Esta função lê o edge /ads
// da conta — a lista real de anúncios — pra que o nível Ad mostre TODOS os
// anúncios do conjunto, mesmo zerados. Exclui DELETED/ARCHIVED (anúncios que o
// usuário tirou do gerenciador) pra não poluir com lixo histórico.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdStructure {
  id: string;
  name: string;
  adset_id: string;
  status: string;      // effective_status (considera herança do pai)
  ownStatus: string;   // status próprio do anúncio (ACTIVE/PAUSED) — pro toggle
  // Identidade REAL do criativo (não o nome do anúncio, que pode repetir entre
  // criativos diferentes). null se o token não puder ler `creative`.
  creativeId: string | null;
  thumbnailUrl: string | null;   // miniatura do criativo (thumbnail_url/image_url)
  creativeLink: string | null;   // link pra ver o criativo no Meta
}

export async function fetchAccountAds(
  account: AdAccount,
  opts: { withCreatives?: boolean } = {},
): Promise<AdStructure[]> {
  if (!account.account_id || !account.access_token) return [];

  // Statuses "vivos" — tudo menos DELETED/ARCHIVED.
  const liveStatuses = [
    "ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED",
    "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS",
    "WITH_ISSUES",
  ];
  // `creative{…}` aninhado (id/miniatura/link) é CARO: obriga o Meta a resolver o
  // criativo de cada anúncio — numa conta grande isso domina o tempo do /ads.
  // Só o ranking de Criativos precisa disso, então é opt-in (withCreatives). A
  // árvore de Campanhas roda SEM creative pra carregar rápido (o link "ver
  // criativo" do anúncio cai no source_url do lead, como antes).
  const params = new URLSearchParams({
    fields: opts.withCreatives
      ? "id,name,adset_id,status,effective_status," +
        "creative{id,thumbnail_url,effective_object_story_id,instagram_permalink_url}"
      : "id,name,adset_id,status,effective_status",
    effective_status: JSON.stringify(liveStatuses),
    limit: "500",
    access_token: account.access_token,
  });

  let nextUrl: string | null =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${account.account_id}/ads?${params}`;
  const out: AdStructure[] = [];
  // Cap defensivo de páginas pra não rodar infinito numa conta gigante.
  for (let page = 0; nextUrl !== null && page < 10; page++) {
    const reqUrl: string = nextUrl;
    try {
      const res: Response = await fetch(reqUrl, {
        next: {
          revalidate: 60,
          tags: ["meta-ads-structure", `meta-ads-structure-${account.account_id}`],
        },
      } as RequestInit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      if (data.error) {
        console.error(`[facebook-ads] /ads ${account.account_id}:`, data.error.message);
        break;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const a of (data.data ?? []) as any[]) {
        if (a?.id && a?.adset_id) {
          const cr = a.creative ?? null;
          const creativeLink =
            cr?.instagram_permalink_url ? String(cr.instagram_permalink_url) :
            cr?.effective_object_story_id ? `https://www.facebook.com/${cr.effective_object_story_id}` :
            null;
          out.push({
            id: String(a.id),
            name: a.name ? String(a.name) : "",
            adset_id: String(a.adset_id),
            status: String(a.effective_status ?? ""),
            ownStatus: String(a.status ?? ""),
            creativeId: cr?.id ? String(cr.id) : null,
            thumbnailUrl: cr?.thumbnail_url ? String(cr.thumbnail_url) : (cr?.image_url ? String(cr.image_url) : null),
            creativeLink,
          });
        }
      }
      nextUrl = data.paging?.next ?? null;
    } catch (err) {
      console.error(`[facebook-ads] /ads ${account.account_id}:`, err);
      break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAccountBudgets — orçamento configurado das campanhas e conjuntos.
//
// O orçamento NÃO vem no /insights (que só traz gasto realizado) — é atributo
// do objeto campaign/adset. Onde ele mora depende do modo:
//   - CBO (orçamento na campanha): daily_budget/lifetime_budget vêm na campanha,
//     e os conjuntos ficam sem budget próprio.
//   - ABO (orçamento no conjunto): a campanha vem sem budget e cada conjunto
//     tem o seu.
// Buscamos os dois níveis e deixamos a árvore mostrar onde existir.
//
// Leitura pura (basta `ads_read`). Valores vêm em CENTAVOS na moeda da conta.
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetCents {
  daily: number | null;      // centavos, moeda da conta
  lifetime: number | null;
}

// Meta de uma campanha/conjunto: orçamento (se houver naquele nível) + status
// configurado (ACTIVE/PAUSED/…). Buscados na mesma chamada.
export interface ObjMeta {
  budget: BudgetCents | null;
  bid: number | null;        // bid_amount em centavos (Limite de lance), se houver
  status: string | null;     // ACTIVE | PAUSED | ARCHIVED | DELETED | ...
  name: string | null;       // nome — pra injetar entidades sem gasto na árvore
  campaignId: string | null; // só em adsets: campanha pai (pra injetar conjunto)
}

export interface AccountObjects {
  campaigns: Map<string, ObjMeta>;   // por campaign_id
  adsets: Map<string, ObjMeta>;      // por adset_id
}

export async function fetchAccountObjects(account: AdAccount): Promise<AccountObjects> {
  const empty: AccountObjects = { campaigns: new Map(), adsets: new Map() };
  if (!account.account_id || !account.access_token) return empty;

  const fetchEdge = async (edge: "campaigns" | "adsets"): Promise<Map<string, ObjMeta>> => {
    const map = new Map<string, ObjMeta>();
    const fields = edge === "adsets"
      ? "id,name,status,daily_budget,lifetime_budget,bid_amount,campaign_id"
      : "id,name,status,daily_budget,lifetime_budget,bid_amount";
    const params = new URLSearchParams({
      fields,
      limit: "500",
      access_token: account.access_token,
    });
    let nextUrl: string | null =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${account.account_id}/${edge}?${params}`;
    // Cap defensivo de páginas (mesmo padrão de fetchAccountAds).
    for (let page = 0; nextUrl !== null && page < 10; page++) {
      const reqUrl: string = nextUrl;
      try {
        const res: Response = await fetch(reqUrl, {
          next: {
            revalidate: 60,
            tags: ["meta-objects", `meta-objects-${account.account_id}`],
          },
        } as RequestInit);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();
        if (data.error) {
          console.error(`[facebook-ads] /${edge} objects ${account.account_id}:`, data.error.message);
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const b of (data.data ?? []) as any[]) {
          if (!b?.id) continue;
          const daily = b.daily_budget ? Number(b.daily_budget) : null;
          const lifetime = b.lifetime_budget ? Number(b.lifetime_budget) : null;
          const bid = b.bid_amount ? Number(b.bid_amount) : null;
          const hasBudget = (daily && daily > 0) || (lifetime && lifetime > 0);
          map.set(String(b.id), {
            budget: hasBudget
              ? { daily: daily && daily > 0 ? daily : null, lifetime: lifetime && lifetime > 0 ? lifetime : null }
              : null,
            bid: bid && bid > 0 ? bid : null,
            status: b.status ? String(b.status) : null,
            name: b.name ? String(b.name) : null,
            campaignId: b.campaign_id ? String(b.campaign_id) : null,
          });
        }
        nextUrl = data.paging?.next ?? null;
      } catch (err) {
        console.error(`[facebook-ads] /${edge} objects ${account.account_id}:`, err);
        break;
      }
    }
    return map;
  };

  const [campaigns, adsets] = await Promise.all([fetchEdge("campaigns"), fetchEdge("adsets")]);
  return { campaigns, adsets };
}

// ── ESCRITA: liga/desliga campanha ou conjunto (status ACTIVE ↔ PAUSED) ──────
// Mesma exigência da edição de orçamento: ads_management no token + acesso de
// gerenciar campanhas na conta. POST no objeto pelo id.
export async function updateMetaStatus(params: {
  accessToken: string;
  metaId: string;
  status: "ACTIVE" | "PAUSED";
}): Promise<UpdateBudgetResult> {
  const { accessToken, metaId, status } = params;
  if (!accessToken || !metaId) return { ok: false, error: "Parâmetros ausentes." };

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${metaId}`;
  const body = new URLSearchParams({ status, access_token: accessToken });
  try {
    const res = await fetch(url, { method: "POST", body, cache: "no-store" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data?.error) {
      const e = data.error;
      return {
        ok: false,
        error: e.message ? String(e.message) : "Erro do Meta",
        userMsg: e.error_user_msg ? String(e.error_user_msg) : undefined,
        code: typeof e.code === "number" ? e.code : undefined,
        subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateMetaBudget — ESCRITA: altera o orçamento de uma campanha ou conjunto.
//
// Primeira operação de escrita do projeto na Graph API. Exige `ads_management`
// no token (ler orçamento basta ads_read; ESCREVER não). POST no objeto pelo
// seu id (campaign_id OU adset_id), setando daily_budget OU lifetime_budget —
// sempre o MESMO campo que a campanha já usa (não trocamos diário↔vitalício
// aqui, que é outra operação). Valor em CENTAVOS na moeda da conta.
//
// Retorna discriminated union: ok:true, ou ok:false com a mensagem do Meta e o
// código (o caller mapeia 200/10/294 = permissão pra uma dica acionável).
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateBudgetResult {
  ok: boolean;
  error?: string;    // message técnica do Meta
  userMsg?: string;  // error_user_msg — versão amigável, quando o Meta manda
  code?: number;
  subcode?: number;
}

export async function updateMetaBudget(params: {
  accessToken: string;
  metaId: string;                              // campaign_id ou adset_id
  field: "daily_budget" | "lifetime_budget";
  cents: number;                               // já em centavos, moeda da conta
}): Promise<UpdateBudgetResult> {
  const { accessToken, metaId, field, cents } = params;
  if (!accessToken || !metaId) return { ok: false, error: "Parâmetros ausentes." };

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${metaId}`;
  const body = new URLSearchParams({
    [field]: String(cents),
    access_token: accessToken,
  });

  try {
    const res = await fetch(url, { method: "POST", body, cache: "no-store" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data?.error) {
      const e = data.error;
      return {
        ok: false,
        error: e.message ? String(e.message) : "Erro do Meta",
        userMsg: e.error_user_msg ? String(e.error_user_msg) : undefined,
        code: typeof e.code === "number" ? e.code : undefined,
        subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
      };
    }
    // Sucesso: Meta devolve { success: true } ou o objeto com o id.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── ESCRITA: Limite de lance (bid_amount) — conjunto (ou campanha que tiver) ──
// Mesma exigência do orçamento: ads_management no token + acesso na conta. POST
// no objeto pelo id. bid_amount é em CENTAVOS, moeda da conta (igual budget).
// Só faz sentido em objetos com estratégia de lance com limite (bid cap).
export async function updateMetaBid(params: {
  accessToken: string;
  metaId: string;                              // adset_id (ou campaign_id se tiver)
  cents: number;                               // já em centavos, moeda da conta
}): Promise<UpdateBudgetResult> {
  const { accessToken, metaId, cents } = params;
  if (!accessToken || !metaId) return { ok: false, error: "Parâmetros ausentes." };

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${metaId}`;
  const body = new URLSearchParams({
    bid_amount: String(cents),
    access_token: accessToken,
  });

  try {
    const res = await fetch(url, { method: "POST", body, cache: "no-store" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data?.error) {
      const e = data.error;
      return {
        ok: false,
        error: e.message ? String(e.message) : "Erro do Meta",
        userMsg: e.error_user_msg ? String(e.error_user_msg) : undefined,
        code: typeof e.code === "number" ? e.code : undefined,
        subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveAdContextFromSourceId
// ─────────────────────────────────────────────────────────────────────────────

export interface AdContext {
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  // Facebook Page ID que veicula o anúncio CTWA. Resolvido via creative.
  // Pode ser null se o source_id for adset/campaign (resolução só funciona
  // no nível do ad) ou se o token não tiver permissão pra ler creative.
  page_id: string | null;
  // account_id REAL retornado pelo Graph (campo do próprio Ad object).
  // Sempre a conta DONA do anúncio, independente de qual token leu.
  // Usado pra desambiguar quando múltiplas contas da mesma BM compartilham
  // System User Token e a Promise.any resolveria "qualquer uma" arbitrariamente.
  real_account_id: string | null;
}

/**
 * Dado um source_id vindo do payload do DataCrazy (que pode ser ad_id, adset_id
 * ou campaign_id dependendo do tipo de anúncio CTWA), tenta resolver o
 * contexto completo via Graph API. Estratégia: pede ad-shape, fica tolerante
 * a respostas parciais. Retorna null se o GET falhar (id inválido, token
 * sem permissão, etc.).
 */
export async function resolveAdContextFromSourceId(
  sourceId: string,
  account: AdAccount
): Promise<AdContext | null> {
  if (!sourceId || !account.access_token) return null;

  // Tenta como ad primeiro (shape mais completo). Se o source_id for adset
  // ou campaign, o Graph retorna erro 100 e a gente cai pros fallbacks.
  // Também puxamos `creative` pra extrair page_id (necessário pro Lead CAPI)
  // e `account_id` pra descobrir a conta REAL dona do anúncio (não a que
  // venceu a corrida do Promise.any).
  const asAd = await tryFetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
      `?fields=id,name,account_id,adset{id,name,campaign{id,name}},` +
      `creative{object_story_spec{page_id},effective_object_story_id}` +
      `&access_token=${account.access_token}`,
    account.account_id
  );
  if (asAd && asAd.adset?.campaign) {
    return {
      ad_id: asAd.id ?? null,
      ad_name: asAd.name ?? null,
      adset_id: asAd.adset.id ?? null,
      adset_name: asAd.adset.name ?? null,
      campaign_id: asAd.adset.campaign.id ?? null,
      campaign_name: asAd.adset.campaign.name ?? null,
      page_id: extractPageId(asAd.creative),
      real_account_id: asAd.account_id ? String(asAd.account_id) : null,
    };
  }

  const asAdset = await tryFetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
      `?fields=id,name,account_id,campaign{id,name}` +
      `&access_token=${account.access_token}`,
    account.account_id
  );
  if (asAdset && asAdset.campaign) {
    return {
      ad_id: null,
      ad_name: null,
      adset_id: asAdset.id ?? null,
      adset_name: asAdset.name ?? null,
      campaign_id: asAdset.campaign.id ?? null,
      campaign_name: asAdset.campaign.name ?? null,
      page_id: null,
      real_account_id: asAdset.account_id ? String(asAdset.account_id) : null,
    };
  }

  const asCampaign = await tryFetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${sourceId}` +
      `?fields=id,name,account_id&access_token=${account.access_token}`,
    account.account_id
  );
  if (asCampaign && asCampaign.id) {
    return {
      ad_id: null,
      ad_name: null,
      adset_id: null,
      adset_name: null,
      campaign_id: asCampaign.id,
      campaign_name: asCampaign.name ?? null,
      page_id: null,
      real_account_id: asCampaign.account_id ? String(asCampaign.account_id) : null,
    };
  }

  return null;
}

// Extrai page_id do creative. Caminho oficial é object_story_spec.page_id,
// mas pra criativos com efeito (dark posts, posts já publicados), só o
// effective_object_story_id está disponível no formato "{page_id}_{post_id}".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPageId(creative: any): string | null {
  if (!creative) return null;
  const explicit = creative?.object_story_spec?.page_id;
  if (explicit) return String(explicit);
  const eosi = creative?.effective_object_story_id;
  if (typeof eosi === "string" && eosi.includes("_")) {
    return eosi.split("_")[0] ?? null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAdAccountNames — resolve nome de N account_ids em paralelo.
// Usado pelo bulk import na UI de Configurações: o usuário cola BM ID + token
// + lista de account IDs, e o sistema busca o nome de cada um pra salvar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve nome + moeda de cada account_id em paralelo via Graph API.
 *
 * Cada GET é em /act_{id}?fields=name,currency — precisa só de `ads_read` no
 * token. Mais resiliente que /{bm_id}/owned_ad_accounts (que exige
 * `business_management` e pode falhar dependendo do System User).
 *
 * `currency` é o campo nativo da conta no Meta (ex: "BRL", "USD"). Normalizamos
 * pra BRL/USD; qualquer outra moeda cai em null (caller decide o default).
 *
 * Retorna pra cada ID: { account_id, name, currency, error }. name/currency
 * são null se a Graph rejeitou (token sem permissão, ID inválido, etc) —
 * caller decide o que fazer (geralmente: ignorar e mostrar pro usuário).
 */
export async function fetchAdAccountNames(
  accountIds: string[],
  accessToken: string,
): Promise<Array<{ account_id: string; name: string | null; currency: "BRL" | "USD" | null; error: string | null }>> {
  return Promise.all(
    accountIds.map(async (id) => {
      const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${id}` +
        `?fields=name,currency&access_token=${accessToken}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (data.error) {
          return {
            account_id: id,
            name: null,
            currency: null,
            error: String(data.error.message ?? "Erro Meta"),
          };
        }
        const raw = String(data.currency ?? "").toUpperCase();
        const currency = raw === "USD" ? "USD" : raw === "BRL" ? "BRL" : null;
        return {
          account_id: id,
          name: data.name ? String(data.name) : null,
          currency,
          error: null,
        };
      } catch (err) {
        return { account_id: id, name: null, currency: null, error: String(err) };
      }
    }),
  );
}

async function tryFetch(
  url: string,
  accountId: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(url, {
      next: {
        revalidate: 60,
        tags: ["meta-source-resolve", `meta-source-${accountId}`],
      },
    } as RequestInit);
    const data = await res.json();
    if (data.error) return null;
    return data;
  } catch {
    return null;
  }
}
