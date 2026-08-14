-- ────────────────────────────────────────────────────────────────────────────
-- Migration: coluna currency em ad_accounts
-- Contas de anúncio podem ser faturadas em moedas diferentes (BRL ou USD).
-- O spend que vem da Graph API está SEMPRE na moeda da conta. Pra agregar tudo
-- num único número em BRL no dashboard, precisamos saber a moeda de cada conta:
--   - contas USD têm o spend convertido USD→BRL (cotação ao vivo) antes de somar
--   - o imposto Meta de 12,5% só incide sobre contas BRL (contas USD não têm
--     esse imposto adicional brasileiro sobre o investimento)
--
-- Auto-detectada via Graph (act_{id}?fields=currency) no cadastro/discover.
-- Default 'BRL' (cobre todas as contas legadas; backfill via
-- POST /api/ad-accounts/refresh-currency).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BRL'
    CHECK (currency IN ('BRL', 'USD'));
