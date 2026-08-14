import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { normalizePhoneBR } from "@/lib/phone";
import { resolveAdContextFromSourceId } from "@/lib/facebook-ads";
import { getWebhookSecrets } from "@/lib/webhook-secrets";

/**
 * Webhook do DataCrazy — recebe a primeira mensagem vinda do anúncio CTWA.
 *
 * Autenticação: header `x-datacrazy-secret` deve bater com o secret configurado
 * no painel (app_settings) ou, na ausência, com a env DATACRAZY_WEBHOOK_SECRET.
 *
 * Fluxo:
 *   1. Extrai phone/ctwa_clid/source_id/source_url/page_id do payload
 *   2. Resolve campaign/adset/ad via Graph API (tenta cada ad_account)
 *   3. Upsert lead por phone
 *
 * O payload bruto é sempre salvo em leads.raw_webhook pra inspeção depois.
 *
 * NOTA: o evento Lead NÃO é mais enviado ao Meta CAPI por aqui — o webhook
 * só registra o lead e resolve a atribuição. (O Purchase continua sendo
 * enviado pelo webhook da Payt.)
 */

interface ExtractedFields {
  phone: string | null;
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  page_id: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFields(body: any): ExtractedFields {
  const phone =
    body?.phone ??
    body?.customer?.phone ??
    body?.contact?.phone ??
    body?.from ??
    body?.sender?.phone ??
    body?.lead?.phone ??
    null;

  const ctwa_clid =
    body?.ctwa_clid ??
    body?.referral?.ctwa_clid ??
    body?.message?.referral?.ctwa_clid ??
    body?.metadata?.ctwa_clid ??
    null;

  const source_id =
    body?.source_id ??
    body?.referral?.source_id ??
    body?.message?.referral?.source_id ??
    body?.metadata?.source_id ??
    null;

  const source_url =
    body?.source_url ??
    body?.referral?.source_url ??
    body?.message?.referral?.source_url ??
    body?.metadata?.source_url ??
    null;

  // page_id = Facebook Page ID que veicula o CTWA. Caminho real ainda
  // depende do que o DataCrazy entrega; tentamos os mais comuns.
  const page_id =
    body?.page_id ??
    body?.referral?.page_id ??
    body?.message?.referral?.page_id ??
    body?.metadata?.page_id ??
    body?.instanceData?.page_id ??
    body?.instanceData?.id ??
    null;

  return {
    phone: phone ? String(phone) : null,
    ctwa_clid: ctwa_clid ? String(ctwa_clid) : null,
    source_id: source_id ? String(source_id) : null,
    source_url: source_url ? String(source_url) : null,
    page_id: page_id ? String(page_id) : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-datacrazy-secret");
    const { datacrazy: expected } = await getWebhookSecrets();
    if (!secret || !expected.value || secret !== expected.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // source_url/page_id continuam sendo extraídos e salvos via raw_webhook,
    // mas não são mais usados aqui (envio ao Meta CAPI foi removido).
    const { phone: rawPhone, ctwa_clid, source_id } = extractFields(body);

    const phone = normalizePhoneBR(rawPhone);
    if (!phone) {
      // Sem telefone válido não há lead utilizável. Loga raw_webhook num
      // placeholder e retorna 200 pra evitar retries do DataCrazy.
      console.warn("[webhook/datacrazy] sem phone válido — payload ignorado");
      return NextResponse.json({ ignored: "no_phone", raw_keys: Object.keys(body ?? {}) });
    }

    const supabase = createAdminClient();

    // Resolver contexto do anúncio.
    //
    // Estratégia em duas camadas:
    //   1. CACHE — se algum lead anterior do mesmo source_id já bateu numa
    //      ad_account, vai direto naquela conta. Cache vive nos próprios
    //      leads (sem migration). Reduz pra 1 request Graph quase sempre.
    //   2. BRUTE-FORCE PARALELO — cache miss / primeiro lead do anúncio:
    //      dispara resolveAdContextFromSourceId em todas as contas ativas
    //      em paralelo via Promise.any. Pega a primeira que matchar. Custo
    //      de latência = a mais lenta (≈300ms) em vez de 50×300ms = 15s+
    //      do loop sequencial original.
    let adAccountId: string | null = null;
    let context = null;
    if (source_id) {
      // ── 1. Cache ────────────────────────────────────────────────────────
      const { data: cached } = await supabase
        .from("leads")
        .select("ad_account_id")
        .eq("source_id", source_id)
        .not("ad_account_id", "is", null)
        .limit(1)
        .maybeSingle();
      const cachedAccountId =
        (cached as { ad_account_id: string } | null)?.ad_account_id ?? null;

      if (cachedAccountId) {
        const { data: a } = await supabase
          .from("ad_accounts")
          .select("id, account_id, access_token")
          .eq("id", cachedAccountId)
          .eq("is_active", true)
          .maybeSingle();
        const account = a as
          | { id: string; account_id: string; access_token: string }
          | null;
        if (account) {
          const ctx = await resolveAdContextFromSourceId(source_id, {
            account_id: account.account_id,
            access_token: account.access_token,
          });
          if (ctx) {
            adAccountId = account.id;
            context = ctx;
          }
        }
      }

      // ── 2. Cache miss / stale — brute-force paralelo ────────────────────
      if (!context) {
        const { data: accounts } = await supabase
          .from("ad_accounts")
          .select("id, account_id, access_token")
          .eq("is_active", true);
        const list = (accounts ?? []) as Array<{
          id: string;
          account_id: string;
          access_token: string;
        }>;
        if (list.length > 0) {
          try {
            const winner = await Promise.any(
              list.map(async a => {
                const ctx = await resolveAdContextFromSourceId(source_id, {
                  account_id: a.account_id,
                  access_token: a.access_token,
                });
                if (!ctx) throw new Error("no-match");
                return { ctx };
              }),
            );
            context = winner.ctx;
            // Usa o account_id REAL retornado pelo Graph (campo do Ad object)
            // pra achar o UUID interno correto. Evita atribuir o lead a uma
            // conta "vizinha" da mesma BM que só tem permissão de leitura.
            if (context.real_account_id) {
              const match = list.find(a => a.account_id === context!.real_account_id);
              adAccountId = match?.id ?? null;
            }
          } catch {
            // Todas as contas falharam — segue sem context.
            // (Promise.any rejeita só quando todos os promises rejeitam.)
          }
        }
      }
    }

    const phoneHash = await sha256(phone);

    // Upsert lead por phone. BLINDAGEM: a atribuição (campaign/adset/ad/account/
    // source_id) só é (re)gravada quando ESTA chamada resolveu um anúncio
    // (`context`). Uma chamada SEM source_id / sem match NÃO entra os campos de
    // atribuição no payload → o upsert não os toca e a atribuição já resolvida é
    // preservada. Isso protege contra a LEONA/DataCrazy dispararem mais de uma
    // vez no funil (o referral do anúncio só vem na 1ª mensagem).
    const upsertPayload: Record<string, unknown> = {
      phone,
      phone_hash: phoneHash,
      raw_webhook: body,
    };
    // ctwa_clid também vem só na 1ª mensagem — não zerar com null depois.
    if (ctwa_clid) upsertPayload.ctwa_clid = ctwa_clid;
    if (context) {
      // pixel_id fica null: com fan-out não há mais "o" pixel do lead.
      upsertPayload.source_id     = source_id;
      upsertPayload.ad_account_id = adAccountId;
      upsertPayload.pixel_id      = null;
      upsertPayload.campaign_id   = context.campaign_id   ?? null;
      upsertPayload.campaign_name = context.campaign_name ?? null;
      upsertPayload.adset_id      = context.adset_id      ?? null;
      upsertPayload.adset_name    = context.adset_name    ?? null;
      upsertPayload.ad_id         = context.ad_id         ?? null;
      upsertPayload.ad_name       = context.ad_name       ?? null;
    }

    const { error: leadError } = await supabase
      .from("leads")
      .upsert(upsertPayload, { onConflict: "phone" });

    if (leadError) {
      console.error("[webhook/datacrazy] upsert lead failed:", leadError);
      return NextResponse.json({ error: leadError.message }, { status: 500 });
    }

    // O envio do evento Lead ao Meta CAPI foi removido — o webhook só registra
    // o lead e resolve a atribuição (campaign/adset/ad). page_id/ctwa_clid
    // continuam salvos no lead via raw_webhook pra uso posterior.
    return NextResponse.json({
      success: true,
      matched_account: !!adAccountId,
      matched_context: !!context,
    });
  } catch (err) {
    console.error("[webhook/datacrazy]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
