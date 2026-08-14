/**
 * Secrets dos webhooks (DataCrazy e Payt/Luminar-pay) com dois níveis:
 *
 *   1. **app_settings['webhook_secrets']** → definido pela UI em
 *      /dashboard/configuracoes (aba Webhooks). Permite o cliente ver e
 *      rotacionar o secret sem acessar a Vercel.
 *   2. **env** (DATACRAZY_WEBHOOK_SECRET / PAYT_WEBHOOK_SECRET) → fallback
 *      pra instalações que ainda não salvaram nada no painel.
 *
 * Qualquer falha de leitura do banco degrada pro env — um problema no
 * Supabase não pode derrubar a autenticação dos webhooks junto.
 */

import { createAdminClient } from "./supabase";

const SETTINGS_KEY = "webhook_secrets";

export type WebhookSecretSource = "painel" | "env" | null;

export interface WebhookSecret {
  value: string | null;
  source: WebhookSecretSource;
}

export interface WebhookSecrets {
  datacrazy: WebhookSecret;
  payt: WebhookSecret;
  skale: WebhookSecret;
}

function resolve(dbValue: unknown, envValue: string | undefined): WebhookSecret {
  if (typeof dbValue === "string" && dbValue.trim().length > 0) {
    return { value: dbValue.trim(), source: "painel" };
  }
  if (envValue && envValue.trim().length > 0) {
    return { value: envValue.trim(), source: "env" };
  }
  return { value: null, source: null };
}

export async function getWebhookSecrets(): Promise<WebhookSecrets> {
  let db: { datacrazy?: unknown; payt?: unknown; skale?: unknown } = {};
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (data?.value && typeof data.value === "object") {
      db = data.value as { datacrazy?: unknown; payt?: unknown; skale?: unknown };
    }
  } catch (err) {
    console.error("[webhook-secrets] leitura falhou, usando env:", err);
  }
  return {
    datacrazy: resolve(db.datacrazy, process.env.DATACRAZY_WEBHOOK_SECRET),
    payt: resolve(db.payt, process.env.PAYT_WEBHOOK_SECRET),
    skale: resolve(db.skale, process.env.SKALE_WEBHOOK_SECRET),
  };
}
