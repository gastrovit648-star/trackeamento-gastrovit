import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { getWebhookSecrets } from "@/lib/webhook-secrets";

const SETTINGS_KEY = "webhook_secrets";

// Vai em query string (Payt) e header (DataCrazy) — restringe a URL-safe pra
// não precisar de encoding em nenhum dos dois lugares.
const SECRET_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** GET → secrets efetivos (valor + origem painel/env) pra exibir na UI. */
export async function GET() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  return NextResponse.json(await getWebhookSecrets());
}

/**
 * PUT → salva um ou mais secrets em app_settings. Body:
 *   { datacrazy?: string, payt?: string, skale?: string }
 * Chave ausente no body mantém o valor atual (merge, não replace).
 */
export async function PUT(request: NextRequest) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const body = await request.json();
  const patch: Record<string, string> = {};

  for (const key of ["datacrazy", "payt", "skale"] as const) {
    if (body[key] === undefined) continue;
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (!SECRET_PATTERN.test(value)) {
      return NextResponse.json(
        {
          error:
            `Secret ${key} inválido: use 8–128 caracteres, apenas letras, ` +
            "números, hífen e underscore.",
        },
        { status: 400 },
      );
    }
    patch[key] = value;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Merge com o que já existe — salvar só o da Payt não pode apagar o do DataCrazy.
  const { data: existing } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const current =
    existing?.value && typeof existing.value === "object"
      ? (existing.value as Record<string, unknown>)
      : {};

  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: SETTINGS_KEY, value: { ...current, ...patch } }, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(await getWebhookSecrets());
}
