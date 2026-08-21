import { createAdminClient } from "./supabase";
import { sha256 } from "./hash";
import { sendMetaCAPIFanOut, type CAPIFanOutResult } from "./meta-capi";

/**
 * Envio do evento Purchase ao Meta CAPI para um pedido — extraído dos webhooks
 * (Payt/Luminar e Skale) pra ser reusado em DOIS momentos:
 *   - na APROVAÇÃO (default): Purchase quando o pagamento confirma.
 *   - no AGENDAMENTO (quando `purchase_on_schedule` está ligado): Purchase já no
 *     scheduled, e o pagamento depois só promove pra approved sem reenviar.
 *
 * Faz: busca pixels ativos → fan-out do Purchase (mesmo event_id determinístico
 * pra todos, Meta dedupa por pixel+event_id) → grava 1 linha em events_log por
 * pixel. Devolve o event_id, a resposta agregada e os hashes PII pra quem chamou
 * gravar em `purchases`.
 */

export interface OrderCAPIInput {
  transactionId: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  value: number;
  currency: string;
  productName: string | null;
  productId: string | null;
  ctwaClid: string | null;
  eventSourceUrl: string;
}

export interface OrderCAPIResult {
  metaEventId: string;
  aggregatedResponse: Record<string, unknown>;
  phoneHash: string | null;
  emailHash: string | null;
  firstNameHash: string | null;
  lastNameHash: string | null;
  fanOutCount: number;
}

export async function sendOrderPurchaseCAPI(
  o: OrderCAPIInput,
  trigger: "sale" | "schedule",
  projectId?: string | null,
): Promise<OrderCAPIResult> {
  const supabase = createAdminClient();

  // Só os pixels cujo capi_mode cobre este gatilho recebem o Purchase.
  //   venda (sale)      → pixels 'sale'     ou 'both'
  //   agendamento (sched) → pixels 'schedule' ou 'both'
  // ('off' nunca recebe.) O event_id é o mesmo pros dois, então um pixel 'both'
  // que recebe agendamento E venda o Meta dedupa (conta uma vez).
  const modes = trigger === "sale" ? ["sale", "both"] : ["schedule", "both"];
  let pixelsQuery = supabase
    .from("pixels")
    .select("pixel_id, access_token")
    .eq("is_active", true)
    .in("capi_mode", modes);
  // Roteamento por projeto (multi-projeto Fase 2): com ?project=<id> na URL do
  // webhook, o Purchase vai SÓ pros pixels daquele projeto (project_ids contém
  // o id). Sem projeto → fan-out pra todos os pixels (comportamento legado).
  if (projectId) pixelsQuery = pixelsQuery.contains("project_ids", [projectId]);
  const { data: pixelsRows } = await pixelsQuery;
  const activePixels = (pixelsRows ?? []) as Array<{ pixel_id: string; access_token: string }>;

  const phoneHash     = o.phone ? await sha256(o.phone) : null;
  const emailHash     = o.email ? await sha256(o.email.toLowerCase()) : null;
  const firstNameHash = o.firstName ? await sha256(o.firstName.toLowerCase()) : null;
  const lastNameHash  = o.lastName  ? await sha256(o.lastName.toLowerCase())  : null;
  const metaEventId   = await sha256(`purchase:${o.transactionId}`);

  let fanOutResults: CAPIFanOutResult[] = [];
  if (activePixels.length > 0) {
    fanOutResults = await sendMetaCAPIFanOut(
      {
        eventName: "Purchase",
        eventId: metaEventId,
        // action_source "website" + event_source_url (checkout Payt): a venda
        // fecha no checkout web, e o ctwa_clid (em user_data) liga ao clique do
        // anúncio CTWA. Decisão mantida a pedido — a URL é necessária.
        actionSource: "website",
        eventSourceUrl: o.eventSourceUrl,
        userData: {
          email: o.email,
          phone: o.phone,
          firstName: o.firstName,
          lastName: o.lastName,
          externalId: o.phone,
          city: o.city,
          state: o.state,
          country: o.country,
          zip: o.zip,
          ctwa_clid: o.ctwaClid,
        },
        customData: {
          value: o.value,
          currency: o.currency,
          content_name: o.productName ?? undefined,
          content_ids: o.productId ? [o.productId] : undefined,
        },
      },
      activePixels.map(p => ({ pixelId: p.pixel_id, accessToken: p.access_token })),
    );
  }

  const aggregatedResponse: Record<string, unknown> =
    fanOutResults.length > 0
      ? Object.fromEntries(fanOutResults.map(r => [r.pixelId, r.response]))
      : { skipped: "no_active_pixels" };

  // events_log — 1 linha por pixel (unique(event_id, pixel_id), migration 010).
  if (fanOutResults.length > 0) {
    await supabase.from("events_log").insert(
      fanOutResults.map(r => ({
        phone: o.phone,
        event_name: "Purchase",
        event_id: metaEventId,
        pixel_id: r.pixelId,
        payload_meta: r.sentPayload,
        response_meta: r.response,
      })),
    );
  }

  return {
    metaEventId,
    aggregatedResponse,
    phoneHash,
    emailHash,
    firstNameHash,
    lastNameHash,
    fanOutCount: fanOutResults.length,
  };
}
