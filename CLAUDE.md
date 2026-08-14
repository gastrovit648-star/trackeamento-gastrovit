## Identidade git deste projeto (PREENCHER ao clonar)

A regra geral sobre identidade git por cliente está em `~/.claude/CLAUDE.md`.
Para ESTE projeto, preencha ao criar a instância a partir do template:

- **Conta GitHub dona do repo**: `[PREENCHER]`
- **Conta Vercel correspondente**: `[PREENCHER]`
- **`user.name`**: `[PREENCHER]`
- **`user.email`**: `[PREENCHER]` (recomendado: e-mail no-reply do GitHub)

Claude deve garantir que `git config user.name/.email` locais correspondem a
esses valores antes de qualquer commit. Não usar `--global`.

## Bootstrap — checklist de novo cliente

Este repositório é um TEMPLATE. Ao criar uma instância nova (via "Use this
template" no GitHub), rode o checklist:

- [ ] Preencher a identidade git acima e aplicar com `git config user.name` /
      `git config user.email` (locais, não `--global`).
- [ ] Criar um projeto Supabase novo e aplicar `sql/bootstrap.sql` inteiro no
      SQL Editor (provisiona schema + migrations numa base nova).
- [ ] Copiar `.env.example` para `.env.local` e preencher: URL/chaves do
      Supabase, webhook secrets e (opcional) Meta/USD.
- [ ] Gerar valores FORTES e aleatórios para `DATACRAZY_WEBHOOK_SECRET` e
      `PAYT_WEBHOOK_SECRET` (não reutilizar de outro cliente).
- [ ] Trocar a marca "Sua Marca" (sidebar, login e `src/app/layout.tsx`) e o
      logo em `public/brand/logo.svg` pela marca do cliente.
- [ ] Criar projeto Vercel, vincular ao repo e configurar as env vars.
- [ ] Criar usuário de login (Supabase Auth → Users) e cadastrar atendentes.
- [ ] Apagar/atualizar esta seção quando o bootstrap terminar.

# CLAUDE.md

Documentação interna pro Claude Code (e humanos). Convenções específicas
deste projeto que não são óbvias do código.

## Supabase — Padrão de criação de tabelas

### Contexto

A partir de **2026-10-30**, o Supabase deixa de expor automaticamente
tabelas do schema `public` via Data API (PostgREST `/rest/v1/`, GraphQL
`/graphql/v1/`). Toda tabela em `public` precisa de `GRANT` explícito para
`anon`, `authenticated` e/ou `service_role`. Sem GRANT, PostgREST retorna
42501 (permission denied).

Ref: https://supabase.com/blog/postgrest-explicit-grants

Conexões diretas via connection string Postgres (psql, pg_cron, scripts
admin com service_role) **NÃO** são afetadas — só a Data API.

### Regra

Toda nova tabela em `public` DEVE incluir, **na mesma migration que cria
a tabela**:

1. `ENABLE ROW LEVEL SECURITY`
2. Policies de RLS específicas ao caso de uso
3. `GRANT` explícito para os roles que precisam de acesso via Data API
4. `REVOKE ALL FROM anon` defensivo (a menos que a tabela seja de leitura
   pública intencional)

### Decisões padrão de grant

| Role | Privilégio default | Quando dar mais |
|---|---|---|
| `anon` | **NADA** (REVOKE defensivo) | Só pra tabelas de leitura pública intencional (catálogo, landing data, posts publicados). Lembre que `NEXT_PUBLIC_SUPABASE_ANON_KEY` vai no bundle JS público — qualquer privilégio a `anon` é exposição direta. |
| `authenticated` | `SELECT` | INSERT/UPDATE/DELETE só se houver um caller browser explícito que precisa mutar. Mutações normalmente devem passar por API route com `service_role`, não pelo client. |
| `service_role` | `ALL` (explícito) | Sempre. Mesmo sendo default no Supabase hoje, declarar explícito para self-documentation e resiliência a mudanças futuras de defaults. |

### Template SQL

Use este bloco ao criar uma nova tabela em `public`. Substitua `<nome>` e
ajuste as policies conforme o caso de uso.

```sql
-- ── CREATE TABLE ───────────────────────────────────────────────────────────
CREATE TABLE <nome> (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- … suas colunas …
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX <nome>_created_at_idx ON <nome>(created_at DESC);

-- ── REVOKE defensivo em anon ───────────────────────────────────────────────
-- Remova esta linha SE a tabela for de leitura pública intencional.
REVOKE ALL ON TABLE public.<nome> FROM anon;

-- ── GRANTs ─────────────────────────────────────────────────────────────────
GRANT SELECT ON TABLE public.<nome> TO authenticated;
GRANT ALL    ON TABLE public.<nome> TO service_role;

-- ── RLS + policies ─────────────────────────────────────────────────────────
ALTER TABLE public.<nome> ENABLE ROW LEVEL SECURITY;

-- Ajuste a policy ao caso de uso. Exemplo: read autenticado sem restrição.
CREATE POLICY "Authenticated read <nome>"
  ON public.<nome> FOR SELECT TO authenticated USING (true);
```

### Convenção operacional do projeto

- Migrations vivem em `sql/migrations/` com numeração sequencial
  (`007_…`, `008_…`). **Não usamos Supabase CLI** — cada migration é
  aplicada manualmente copiando o SQL no SQL Editor do Supabase.
- DDL inicial das tabelas existentes está em `sql/schema.sql`.
- `sql/bootstrap.sql` é a concatenação one-shot (schema + migrations 007–014,
  menos a redundante `012_ad_accounts_currency`) usada pra provisionar uma
  base **nova** num paste único.
  Base já existente usa as migrations individuais. Se novas
  migrations surgirem, elas NÃO entram automaticamente no bootstrap.sql —
  regenerar se for re-provisionar.
- Tornar a migration idempotente quando possível: `IF NOT EXISTS`,
  `OR REPLACE`, `unschedule` antes de `schedule`, etc.

### Migration de referência

Todas as migrations em [sql/migrations/](sql/migrations/) deste projeto já
nascem com o padrão (`ad_accounts`, `attendants`, `pixels`, `leads`,
`purchases`, `events_log`). Use [sql/migrations/001_ad_accounts.sql](sql/migrations/001_ad_accounts.sql)
como ponto de partida para futuras migrations.

## Data efetiva de venda: approved_at (dia do pagamento)

A partir da migration [sql/migrations/016_purchases_approved_at.sql](sql/migrations/016_purchases_approved_at.sql),
vendas aprovadas/reembolsadas contam no dashboard pelo dia da **APROVAÇÃO**
(`purchases.approved_at`), não pelo dia em que a transação foi criada.
Motivo: boleto/PIX entra como `pending` no dia da geração e o upsert de
aprovação do webhook só mudava o status (o `created_at` não muda) — a venda
aparecia no dia da geração, divergindo do Purchase do CAPI (enviado no dia
do pagamento).

Regras:

- **Gravação**: `approved_at = now()` é setado APENAS no upsert de aprovação
  do webhook Payt/Luminar e no insert de `/api/manual-purchase`. O guard de
  idempotência por `meta_event_id` garante que retries não reprocessam a
  aprovação. **Refund NÃO altera `approved_at`** — a venda continua contando
  no dia em que foi aprovada.
- **Data efetiva** = `approved_at` com fallback `created_at` (linhas legadas
  anteriores à migration receberam backfill `approved_at = created_at`, mas
  o fallback protege qualquer NULL residual). A migration
  [017](sql/migrations/017_purchases_approved_at_recarimbo.sql) recarimbou o
  legado com o horário real da aprovação via `events_log`
  (`meta_event_id == event_id`, `MIN(created_at)` do Purchase); vendas sem
  linha em `events_log` ficaram com o fallback.
- **Por métrica** (helpers em [src/lib/queries.ts](src/lib/queries.ts)):
  - Vendas aprovadas/reembolsadas (contagem, revenue, ROAS, matchRate,
    ticket médio, geo, afiliados) → **data efetiva de aprovação**.
  - Boletos/PIX **gerados** e cartões **recusados** → **sempre `created_at`**.
    O boleto gerado dia X e pago dia Y conta como *gerado* em X e como
    *venda* em Y.
- **Como filtrar**: `effectiveDateOr(from, to)` (string pra `.or()` do
  PostgREST — data efetiva no range) nas queries só de aprovadas;
  `anyDateOr(from, to)` (created_at OU approved_at no range) nas queries que
  alimentam aprovação E geração de uma vez (Overview, árvore de Campanhas),
  com refino em JS via `makeInRange()` (comparação por epoch, não string).
  Toda query nova de `purchases` com filtro de período DEVE usar um desses
  helpers — nunca `.gte/.lte("created_at", …)` direto pra métricas de venda.

## Identificador principal: telefone (E.164 BR)

Diferente do `pixelhub`, este projeto NÃO usa `user_id` (cookie/UUID) como
identificador de pessoa. O canal de entrada é o WhatsApp, então o identificador
é o **telefone normalizado**: DDI (55) + DDD (2 dígitos) + 9 + 8 dígitos =
sempre **13 dígitos**.

Toda entrada de telefone (webhook DataCrazy, postback Payt, envio CAPI) DEVE
passar por `normalizePhoneBR()` em [src/lib/phone.ts](src/lib/phone.ts) antes
de ser usada em query ou hash. Quem envia hash sem normalizar quebra o match
entre `leads.phone` e `purchases.phone`.

## Conversão de gasto USD→BRL (multimoeda)

Contas de anúncio em USD têm o `spend` (que vem na moeda da conta) convertido
pra BRL antes de agregar no dashboard. O imposto Meta de 12,5% só incide sobre
contas BRL (ver [src/lib/queries.ts](src/lib/queries.ts), `taxableSpend`).

**O Meta NÃO expõe na API a taxa de câmbio que ele usa pra faturar.** Por isso
a cotação é informada à mão. Precedência da cotação (lib
[src/lib/exchange-rate.ts](src/lib/exchange-rate.ts)):

1. **`usd_brl_rates[data]`** — cotação travada POR DIA, preenchida manualmente em
   Configurações → "Cotação do dólar". O gasto de cada dia é convertido pela
   taxa daquela data (contas USD são buscadas com `time_increment=1`).
2. **`app_settings.usd_brl_rate`** — fallback global pros dias sem cotação:
   `mode=manual` (valor fixo) ou `mode=auto` (cotação ao vivo AwesomeAPI).

A árvore de Campanhas (agregada por campanha, não por dia) usa a **taxa efetiva**
do período = média das cotações diárias ponderada pelo spend de cada dia
(`effectiveUsdRate` em queries.ts), pra bater com o total do Overview.
