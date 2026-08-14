"use server";

import { revalidateTag } from "next/cache";

// Invalida o cache de fetches taggeados como "meta-insights" (Ads API) e
// "meta-source-resolve" (lookup de source_id → ad/adset/campaign).
// Acionada pelo botão de refresh do header.
export async function revalidateMetaInsights() {
  revalidateTag("meta-insights");
  revalidateTag("meta-source-resolve");
}
