import { sha256 } from "./hash";

// Meta CAPI exige city sem acentos, lowercase, antes de hashear
function normalizeCity(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Country/state: lowercase trim. Estados BR podem chegar como "CE" ou "Ceará";
// Meta espera ISO 3166-2 (sigla 2 letras) ou nome — sigla é o caminho seguro.
function normalizeRegion(s: string): string {
  return s.trim().toLowerCase();
}

// ZIP/CEP: só dígitos. CEP brasileiro tem 8 dígitos (ex: "60361-100" → "60361100").
function normalizeZip(zip: string): string {
  return zip.replace(/\D/g, "");
}

export interface CAPIUserData {
  email?: string | null;
  phone?: string | null;         // já normalizado (E.164 sem +)
  firstName?: string | null;
  lastName?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  externalId?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  // Click-to-WhatsApp click ID. Plain text (NÃO hashear). Caminho recomendado
  // pela Meta a partir de 2024-2025 é dentro de user_data; mantemos no
  // custom_data também (alguns dashboards/atribuições ainda olham lá).
  ctwa_clid?: string | null;
}

export interface CAPIEvent {
  eventName: string;
  eventId: string;
  eventTime?: number;
  pixelId: string;
  accessToken: string;           // resolvido caller-side via tabela `pixels`
  userData: CAPIUserData;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
  actionSource?: "website" | "chat" | "phone_call" | "email" | "system_generated";
}

export interface CAPIResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: unknown;
  retries?: number;
  retries_exhausted?: boolean;
}

export interface CAPIResult {
  response: CAPIResponse;
  sentPayload: Record<string, unknown>;
}

export async function sendMetaCAPI(event: CAPIEvent): Promise<CAPIResult> {
  const {
    eventName,
    eventId,
    eventTime,
    pixelId,
    accessToken,
    userData,
    customData,
    eventSourceUrl,
    actionSource,
  } = event;

  const hashedUser: Record<string, unknown> = {};

  // ── Campos PII — SHA-256 hashed ──
  // Email (`em`): enviado quando presente e com formato válido — grande parte
  // dos emails dos postbacks é REAL, então mandar reforça o match do Meta.
  // Normaliza (trim + lowercase) antes de hashear, como a Meta exige. Emails
  // vazios/malformados são pulados; um fake único que não casa é ignorado pela
  // Meta (cai no telefone/external_id).
  if (userData.email) {
    const em = userData.email.trim().toLowerCase();
    if (em.includes("@")) hashedUser.em = await sha256(em);
  }
  if (userData.phone)      hashedUser.ph = await sha256(userData.phone.replace(/\D/g, ""));
  if (userData.firstName)  hashedUser.fn = await sha256(userData.firstName);
  if (userData.lastName)   hashedUser.ln = await sha256(userData.lastName);

  // ── Geo — SHA-256 hashed (após normalização exigida pela Meta) ──
  if (userData.country) hashedUser.country = await sha256(normalizeRegion(userData.country));
  if (userData.state)   hashedUser.st      = await sha256(normalizeRegion(userData.state));
  if (userData.city)    hashedUser.ct      = await sha256(normalizeCity(userData.city));
  if (userData.zip)     hashedUser.zp      = await sha256(normalizeZip(userData.zip));

  // ── External ID — SHA-256 hashed ──
  if (userData.externalId) hashedUser.external_id = await sha256(userData.externalId);

  // ── Browser identifiers — NÃO hashear ──
  if (userData.fbp) hashedUser.fbp = userData.fbp;
  if (userData.fbc) hashedUser.fbc = userData.fbc;

  // ── Click-to-WhatsApp click ID — NÃO hashear ──
  if (userData.ctwa_clid) hashedUser.ctwa_clid = userData.ctwa_clid;

  // ── Network data — plain text ──
  if (userData.ip)        hashedUser.client_ip_address = userData.ip;
  if (userData.userAgent) hashedUser.client_user_agent = userData.userAgent;

  const payload: Record<string, unknown> = {
    data: [{
      event_name: eventName,
      event_id: eventId,
      event_time: eventTime ?? Math.floor(Date.now() / 1000),
      event_source_url: eventSourceUrl,
      action_source: actionSource ?? "website",
      user_data: hashedUser,
      custom_data: customData,
    }],
  };

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events`;

  // Retry com backoff curto: tentativa imediata + 500ms + 1500ms.
  // Retriable: HTTP 429 (rate limit), 5xx (Meta com problema), network error.
  // Não retriable (não amplifica): 4xx que não seja 429 (token inválido,
  // payload malformado) — devolve o erro pra logar e seguir.
  const delays = [0, 500, 1500];
  let lastNetworkError: string | null = null;
  let lastHttpStatus: number | null = null;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      // 429 ou 5xx → retry
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastHttpStatus = res.status;
        // Drena body pra liberar a conexão antes de tentar de novo
        await res.text().catch(() => null);
        continue;
      }
      // 2xx ou 4xx ≠ 429 → resposta final
      const response = await res.json();
      if (attempt > 0) response.retries = attempt;
      return { response, sentPayload: payload };
    } catch (err) {
      lastNetworkError = String(err);
      // Network error é retriável
      continue;
    }
  }
  // Todas as tentativas falharam
  return {
    response: {
      error: lastNetworkError ?? `HTTP ${lastHttpStatus} após ${delays.length} tentativas`,
      retries_exhausted: true,
    },
    sentPayload: payload,
  };
}

export interface PixelTarget {
  pixelId: string;
  accessToken: string;
}

export interface CAPIFanOutResult {
  pixelId: string;
  response: CAPIResponse;
  sentPayload: Record<string, unknown>;
}

// Dispara o mesmo evento pra N pixels em paralelo. Cada pixel mantém seu
// próprio retry interno (3 tentativas, ~2s) via sendMetaCAPI. Promise.allSettled
// garante que falha em um pixel não derruba os outros — tempo total ≈ pixel
// mais lento, não soma sequencial. Meta dedupa por (pixel, event_id), então
// reusar o mesmo event_id entre pixels é correto.
export async function sendMetaCAPIFanOut(
  base: Omit<CAPIEvent, "pixelId" | "accessToken">,
  targets: PixelTarget[],
): Promise<CAPIFanOutResult[]> {
  if (targets.length === 0) return [];
  const settled = await Promise.allSettled(
    targets.map(t =>
      sendMetaCAPI({ ...base, pixelId: t.pixelId, accessToken: t.accessToken }),
    ),
  );
  return targets.map((t, i) => {
    const s = settled[i];
    if (s.status === "fulfilled") {
      return {
        pixelId: t.pixelId,
        response: s.value.response,
        sentPayload: s.value.sentPayload,
      };
    }
    return {
      pixelId: t.pixelId,
      response: { error: String(s.reason), retries_exhausted: true },
      sentPayload: {},
    };
  });
}
