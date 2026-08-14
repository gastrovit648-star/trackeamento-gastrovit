import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase";

/**
 * Gate de autenticação para API routes /api/* internas (CRUD do dashboard).
 * Retorna `null` se houver sessão Supabase válida, ou um NextResponse 401
 * que o handler deve retornar diretamente.
 *
 * Webhooks externos (datacrazy, payt) NÃO usam esta função — autenticam por
 * header secret em vez de sessão de browser.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
