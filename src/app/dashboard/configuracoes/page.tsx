import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase";
import { getUsdRateConfig, fetchLiveUsdToBrlRate } from "@/lib/exchange-rate";
import { getWebhookSecrets } from "@/lib/webhook-secrets";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const supabase = createAdminClient();

  // Monta o baseUrl a partir do domínio da requisição pra documentar as URLs
  // dos webhooks. Atrás do proxy da Vercel, o host real vem em x-forwarded-host.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "https://SEU-DOMINIO";

  const [adAccountsRes, attendantsRes, pixelsRes, projectsRes, dailyRatesRes, usdConfig, usdLiveRate, webhookSecrets] = await Promise.all([
    supabase.from("ad_accounts")
      .select("id, bm_id, account_id, name, currency, is_active, project_ids, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("attendants")
      .select("id, email, name, is_active, project_ids, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("pixels")
      .select("id, pixel_id, name, is_default, capi_mode, project_ids, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("projects")
      .select("id, name, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("usd_brl_rates")
      .select("date, rate, updated_at")
      .order("date", { ascending: false })
      .limit(180),
    getUsdRateConfig(),
    fetchLiveUsdToBrlRate(),
    getWebhookSecrets(),
  ]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <span className="h-1 w-1 rounded-full bg-primary" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Cadastros operacionais
        </span>
        <span className="flex-1 h-px bg-border/60" />
      </div>
      <SettingsTabs
        initialAdAccounts={adAccountsRes.data ?? []}
        initialAttendants={attendantsRes.data ?? []}
        initialPixels={pixelsRes.data ?? []}
        initialProjects={projectsRes.data ?? []}
        initialUsdRate={{ config: usdConfig, liveRate: usdLiveRate, dailyRates: dailyRatesRes.data ?? [] }}
        initialWebhookSecrets={webhookSecrets}
        baseUrl={baseUrl}
        initialTab={searchParams.tab}
      />
    </div>
  );
}
