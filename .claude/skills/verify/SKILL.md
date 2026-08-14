---
name: verify
description: Como buildar, rodar e verificar mudanças deste app (Next.js + Supabase) de ponta a ponta.
---

# Verificação — tracking-tracking

## Rodar

- `npm run dev` (background). **Atenção**: a porta 3000 costuma estar ocupada
  por outro app nesta máquina — o Next cai pra 3001. Sempre conferir a porta
  real no output antes de dar curl.
- `.env.local` já tem as credenciais do Supabase real do cliente — o dev
  server fala com o banco de produção. Limpar qualquer dado de teste depois.

## Superfícies

- **Webhooks (sem sessão)**: `POST /api/webhook/datacrazy` (header
  `x-datacrazy-secret`) e `POST /api/webhook/payt?token=...`. Payloads `{}`
  passam a auth mas não gravam lead/venda (`no_phone` / `no_transaction_id`)
  — probe seguro. O da Payt grava **1 linha em `webhook_log` por request**
  (até nas rejeitadas) — apagar depois via PostgREST.
- **APIs internas e páginas /dashboard**: exigem sessão Supabase (cookie).
  Receita que funciona:
  1. Criar usuário via `POST {SUPABASE_URL}/auth/v1/admin/users` com service
     role (`email_confirm: true`).
  2. Gerar o cookie com a própria lib: `createServerClient` do `@supabase/ssr`
     com um jar fake em `cookies.setAll`, chamar `signInWithPassword`, juntar
     `name=value` com `; `. (Script .mjs na raiz do projeto pra resolver
     node_modules; apagar depois.)
  3. `curl -H "Cookie: <jar>"` nas rotas/páginas.
  4. Apagar o usuário via `DELETE /auth/v1/admin/users/{id}`.
- **Limpeza via PostgREST**: `DELETE {SUPABASE_URL}/rest/v1/<tabela>?col=eq.X`
  com service role em `apikey` + `Authorization: Bearer`.

## Gotchas

- Não há Playwright instalado — pra evidência de UI server-rendered, dar curl
  na página com cookie e grepar o payload RSC pelo dado esperado.
- `curl.exe` no PowerShell: escapar aspas do JSON com `\"` dentro de `'...'`.
