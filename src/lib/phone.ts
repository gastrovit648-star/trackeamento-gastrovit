/**
 * Normaliza um telefone brasileiro para o formato CAPI/E.164:
 * 55 + DDD (2 dígitos) + 9 + 8 dígitos = sempre 13 dígitos.
 *
 * Aceita entradas com ruído (parênteses, hífens, espaços, +) e cobre:
 *  - "11987654321"            → "5511987654321"
 *  - "5511987654321"          → "5511987654321"
 *  - "+55 (11) 9 8765-4321"   → "5511987654321"
 *  - "1187654321"  (sem o 9)  → "5511987654321"  (insere 9 após DDD)
 *  - "119987654321" (9 a mais)→ "5511987654321"  (remove o 9 duplicado)
 *
 * Os dois últimos casos são os erros de digitação típicos do lançamento manual
 * de venda. Corrigi-los aqui é o que mantém `purchases.phone` batendo com
 * `leads.phone` gravado pelo webhook do DataCrazy — sem isso a venda entra sem
 * atribuição de campanha.
 *
 * Retorna null se o resultado não puder convergir pra 11 dígitos (DDD+9+8).
 */
export function normalizePhoneBR(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;

  // Remove DDI 55 se vier. >= 12 protege contra falso-positivo em números
  // sem DDI que começam com 55 (ex: "5598765-4321" = 5598765-4321 → 9 dígitos).
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);

  // Celular antigo sem 9: DDD (2) + 8 dígitos = 10 → insere 9 após DDD.
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);

  // 9 digitado a mais: DDD (2) + "99" + 8 dígitos = 12. Número nacional
  // brasileiro nunca tem 12 dígitos, então é erro com certeza; o engano típico
  // é duplicar o 9 do celular, então remove UM dos dois.
  //
  // A guarda dos DOIS noves é o que torna isso seguro: celular legítimo que
  // começa com 99 (ex: 11 99999-9999) tem 11 dígitos e nunca entra aqui.
  // Qualquer outro 12 dígitos é erro indecifrável e continua virando null —
  // melhor recusar que chutar e gravar o telefone de outra pessoa.
  if (d.length === 12 && d[2] === "9" && d[3] === "9") {
    d = d.slice(0, 2) + d.slice(3);
  }

  if (d.length !== 11) return null;
  return "55" + d;
}
