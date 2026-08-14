/**
 * Cotação USD→BRL com dois modos (configuráveis em /dashboard/configuracoes):
 *
 *   - **auto**   → cotação ao vivo na AwesomeAPI (gratuita, sem chave, foco BR),
 *                  com cache (`revalidate: 3600`, no máx. 1 hit/hora) e fallback.
 *   - **manual** → valor fixo definido pelo usuário em app_settings, útil pra
 *                  travar uma cotação num período (fechamento contábil etc.).
 *
 * Usado pra converter o spend de contas de anúncio faturadas em dólar pro
 * número agregado em BRL exibido no dashboard. A cotação histórica NÃO é travada
 * na data do gasto — o spend em USD é reavaliado pela cotação efetiva a cada
 * carregamento (decisão de produto: simplicidade > precisão contábil).
 *
 * Fallback (modo auto, API fora): USD_BRL_FALLBACK_RATE do ambiente, ou 5.40.
 */

import { createAdminClient } from "./supabase";

const FALLBACK_RATE = Number(process.env.USD_BRL_FALLBACK_RATE) || 5.4;
const SETTINGS_KEY = "usd_brl_rate";

export interface UsdRateConfig {
  mode: "auto" | "manual";
  manual_rate: number | null;
}

const DEFAULT_CONFIG: UsdRateConfig = { mode: "auto", manual_rate: null };

/**
 * Lê a config de cotação salva em app_settings. Qualquer falha (tabela ausente,
 * valor inválido) degrada para modo automático — nunca quebra o dashboard.
 */
export async function getUsdRateConfig(): Promise<UsdRateConfig> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const v = data?.value as Partial<UsdRateConfig> | undefined;
    const rate = Number(v?.manual_rate);
    if (v?.mode === "manual" && Number.isFinite(rate) && rate > 0) {
      return { mode: "manual", manual_rate: rate };
    }
  } catch (err) {
    console.error("[exchange-rate] leitura de config falhou, usando automático:", err);
  }
  return DEFAULT_CONFIG;
}

/** Cotação ao vivo USD→BRL (AwesomeAPI), com cache e fallback. */
export async function fetchLiveUsdToBrlRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://economia.awesomeapi.com.br/json/last/USD-BRL",
      { next: { revalidate: 3600, tags: ["usd-brl-rate"] } } as RequestInit,
    );
    const data = await res.json();
    const bid = parseFloat(data?.USDBRL?.bid);
    if (Number.isFinite(bid) && bid > 0) return bid;
  } catch (err) {
    console.error("[exchange-rate] USD-BRL fetch falhou, usando fallback:", err);
  }
  return FALLBACK_RATE;
}

/**
 * Cotação USD→BRL de FALLBACK global. Respeita o modo manual quando configurado;
 * caso contrário busca a cotação ao vivo. Usada para dias sem cotação específica
 * em usd_brl_rates (ver getUsdRatesForRange).
 */
export async function getUsdToBrlRate(): Promise<number> {
  const config = await getUsdRateConfig();
  if (config.mode === "manual" && config.manual_rate) {
    return config.manual_rate;
  }
  return fetchLiveUsdToBrlRate();
}

/**
 * Cotações USD→BRL travadas por dia (tabela usd_brl_rates), no intervalo
 * [since, until] (datas YYYY-MM-DD, fuso da conta). Retorna um Map data→taxa.
 *
 * Dias ausentes NÃO entram no Map — o caller decide o fallback (tipicamente
 * getUsdToBrlRate). Qualquer falha degrada para Map vazio (tudo cai no fallback).
 */
export async function getUsdRatesForRange(
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("usd_brl_rates")
      .select("date, rate")
      .gte("date", since)
      .lte("date", until);
    for (const row of (data ?? []) as Array<{ date: string; rate: number | string }>) {
      const rate = Number(row.rate);
      if (Number.isFinite(rate) && rate > 0) map.set(row.date, rate);
    }
  } catch (err) {
    console.error("[exchange-rate] leitura de cotações diárias falhou:", err);
  }
  return map;
}
