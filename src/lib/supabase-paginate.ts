// PostgREST trunca .select() em 1000 linhas por padrão. Para queries que
// alimentam agregações (counts, sums, distinct sets), isso causa números
// silenciosamente menores que a realidade quando o volume passa de 1k.
// Use fetchAllPaginated para puxar a janela inteira em blocos de 1000.

const PAGE_SIZE = 1000;

// Tipagem do builder do Postgrest é parametrizada em ~7 generics e varia entre
// FilterBuilder/TransformBuilder. Aceitar qualquer builder que tenha .range()
// e seja awaitable evita reproduzir esses generics aqui sem perder o T do
// resultado (cada call site passa T explicitamente).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RangeableBuilder = any;

export async function fetchAllPaginated<T>(
  buildQuery: () => RangeableBuilder
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}
