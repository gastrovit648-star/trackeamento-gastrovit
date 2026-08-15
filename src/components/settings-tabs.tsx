"use client";

import { useState, useTransition, Fragment, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Copy, Check, RefreshCw, KeyRound } from "lucide-react";
import type { WebhookSecrets } from "@/lib/webhook-secrets";

export interface AdAccount {
  id: string;
  bm_id: string;
  account_id: string;
  name: string;
  currency: "BRL" | "USD";
  is_active: boolean;
  project_ids: string[];
  created_at: string;
}
export interface Attendant {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  project_ids: string[];
  created_at: string;
}
export interface Pixel {
  id: string;
  pixel_id: string;
  name: string | null;
  is_default: boolean;
  capi_mode: "sale" | "schedule" | "both" | "off";
  project_ids: string[];
  created_at: string;
}
export interface Project {
  id: string;
  name: string;
  created_at: string;
}

export interface UsdRateConfig {
  mode: "auto" | "manual";
  manual_rate: number | null;
}
export interface DailyRate {
  date: string;   // YYYY-MM-DD
  rate: number;
  updated_at?: string;
}

interface Props {
  initialAdAccounts: AdAccount[];
  initialAttendants: Attendant[];
  initialPixels: Pixel[];
  initialProjects: Project[];
  initialUsdRate: { config: UsdRateConfig; liveRate: number; dailyRates: DailyRate[] };
  initialWebhookSecrets: WebhookSecrets;
  baseUrl: string;
  initialTab?: string;
}

export function SettingsTabs({ initialAdAccounts, initialAttendants, initialPixels, initialProjects, initialUsdRate, initialWebhookSecrets, baseUrl, initialTab }: Props) {
  // O seletor de projeto (sidebar) linka pra cá com ?tab=projetos.
  const defaultTab = initialTab === "projetos" ? "projetos" : "ad-accounts";
  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList>
        <TabsTrigger value="ad-accounts">Contas de anúncio</TabsTrigger>
        <TabsTrigger value="attendants">Atendentes</TabsTrigger>
        <TabsTrigger value="pixels">Pixels</TabsTrigger>
        <TabsTrigger value="projetos">Projetos</TabsTrigger>
        <TabsTrigger value="dolar">Cotação do dólar</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
      </TabsList>

      <TabsContent value="ad-accounts">
        <AdAccountsPanel initial={initialAdAccounts} />
      </TabsContent>
      <TabsContent value="attendants">
        <AttendantsPanel initial={initialAttendants} />
      </TabsContent>
      <TabsContent value="pixels">
        <PixelsPanel initial={initialPixels} />
      </TabsContent>
      <TabsContent value="projetos">
        <ProjectsPanel
          initialProjects={initialProjects}
          initialAdAccounts={initialAdAccounts}
          initialPixels={initialPixels}
          initialAttendants={initialAttendants}
        />
      </TabsContent>
      <TabsContent value="dolar">
        <UsdRatePanel initial={initialUsdRate} />
      </TabsContent>
      <TabsContent value="webhooks">
        <WebhooksPanel baseUrl={baseUrl} initialSecrets={initialWebhookSecrets} />
      </TabsContent>
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AdAccountsPanel({ initial }: { initial: AdAccount[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"bulk" | "manual">("bulk");

  // ── Troca de token de uma conta já cadastrada ────────────────────────────
  // O token atual NÃO é exibido (segredo — a query de contas nem o retorna);
  // aqui só colamos um novo, que substitui o anterior via PATCH.
  const [tokenEditId, setTokenEditId] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenSavedId, setTokenSavedId] = useState<string | null>(null);

  function openTokenEdit(id: string) {
    setError(null);
    setTokenSavedId(null);
    setTokenDraft("");
    setTokenEditId(prev => (prev === id ? null : id));
  }

  async function handleUpdateToken(id: string) {
    const token = tokenDraft.trim();
    if (token.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/ad-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro ao trocar o token"); return; }
      setTokenEditId(null);
      setTokenDraft("");
      setTokenSavedId(id);
      setTimeout(() => setTokenSavedId(cur => (cur === id ? null : cur)), 2500);
    });
  }

  // ── Estado do fluxo bulk (cola IDs → resolve nomes → cadastrar) ─────────
  const [bulkBmId, setBulkBmId] = useState("");
  const [bulkToken, setBulkToken] = useState("");
  const [bulkIds, setBulkIds] = useState("");
  const [discovered, setDiscovered] = useState<
    Array<{
      account_id: string;
      name: string | null;
      currency: "BRL" | "USD";
      error: string | null;
      already_registered: boolean;
      selected: boolean;
    }>
  >([]);

  async function handleDiscover(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDiscovered([]);
    startTransition(async () => {
      const res = await fetch("/api/ad-accounts/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bm_id: bulkBmId,
          access_token: bulkToken,
          account_ids: bulkIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setDiscovered(
        (json.accounts as Array<{
          account_id: string;
          name: string | null;
          currency: "BRL" | "USD";
          error: string | null;
          already_registered: boolean;
        }>).map(a => ({
          ...a,
          // Pré-marca todas que foram resolvidas com sucesso — incluindo as
          // já cadastradas (caso de renovação de token expirado).
          selected: !!a.name,
        })),
      );
    });
  }

  async function handleBulkCreate() {
    setError(null);
    // Aceita TANTO contas novas quanto já cadastradas. Backend faz upsert
    // (onConflict account_id) → atualiza access_token + name das existentes.
    const accounts = discovered
      .filter(a => a.selected && !!a.name)
      .map(a => ({ account_id: a.account_id, name: a.name as string, currency: a.currency }));
    if (accounts.length === 0) { setError("Nenhuma conta selecionada"); return; }
    startTransition(async () => {
      const res = await fetch("/api/ad-accounts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bm_id: bulkBmId, access_token: bulkToken, accounts }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      // Substitui rows existentes (mesmo id) pelos retornados; mantém o resto
      const upserted = json.data as AdAccount[];
      const upsertedIds = new Set(upserted.map(d => d.id));
      setRows(r => [...upserted, ...r.filter(x => !upsertedIds.has(x.id))]);
      setDiscovered([]);
      setBulkBmId("");
      setBulkToken("");
      setBulkIds("");
      router.refresh();
    });
  }

  // ── Cadastro manual (1 conta por vez) ────────────────────────────────────
  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      bm_id: fd.get("bm_id"),
      account_id: fd.get("account_id"),
      name: fd.get("name"),
      access_token: fd.get("access_token"),
    };
    startTransition(async () => {
      const res = await fetch("/api/ad-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setRows(r => [json.data, ...r]);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar esta conta de anúncio?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/ad-accounts/${id}`, { method: "DELETE" });
      if (!res.ok) { setError("Erro ao apagar"); return; }
      setRows(r => r.filter(x => x.id !== id));
      router.refresh();
    });
  }

  // Re-detecta a moeda (BRL/USD) de todas as contas via Graph. Útil pra
  // backfill das contas legadas (nasceram como BRL antes da detecção automática).
  async function handleRefreshCurrency() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/ad-accounts/refresh-currency", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      const byId = new Map(
        (json.results as Array<{ account_id: string; to?: "BRL" | "USD" }>)
          .filter(r => r.to)
          .map(r => [r.account_id, r.to as "BRL" | "USD"]),
      );
      setRows(r => r.map(x => (byId.has(x.account_id) ? { ...x, currency: byId.get(x.account_id)! } : x)));
      router.refresh();
    });
  }

  const selectedNewCount = discovered.filter(a => a.selected && !!a.name && !a.already_registered).length;
  const selectedUpdateCount = discovered.filter(a => a.selected && !!a.name && a.already_registered).length;
  const selectedCount = selectedNewCount + selectedUpdateCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contas de anúncio</CardTitle>
        <div className="flex gap-1 text-xs pt-2">
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={`px-3 py-1 rounded border ${mode === "bulk" ? "bg-accent" : "hover:bg-accent"}`}
          >
            Importar BM
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`px-3 py-1 rounded border ${mode === "manual" ? "bg-accent" : "hover:bg-accent"}`}
          >
            Manual
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {mode === "bulk" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Cola o BM ID + Access Token + lista de Account IDs (separados por vírgula,
              quebra de linha ou espaço). O sistema resolve o nome de cada conta via
              Graph API e você confirma quais cadastrar.
            </p>
            <form onSubmit={handleDiscover} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>BM ID</Label>
                  <Input
                    value={bulkBmId}
                    onChange={e => setBulkBmId(e.target.value)}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Access Token</Label>
                  <Input
                    value={bulkToken}
                    onChange={e => setBulkToken(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <Label>Account IDs</Label>
                <textarea
                  value={bulkIds}
                  onChange={e => setBulkIds(e.target.value)}
                  required
                  rows={4}
                  placeholder="1234567890123456, 9876543210987654, ..."
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sem prefixo <code>act_</code>. Separadores aceitos: vírgula, quebra de linha, espaço.
                </p>
              </div>
              <Button type="submit" disabled={pending} className="md:w-fit">
                {pending ? "Resolvendo nomes…" : "Buscar nomes"}
              </Button>
            </form>

            {discovered.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {discovered.length} conta(s) processada(s) · {selectedCount} selecionada(s)
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDiscovered(d =>
                          d.map(a => ({ ...a, selected: !!a.name })),
                        )
                      }
                    >
                      Selecionar todas
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDiscovered(d => d.map(a => ({ ...a, selected: false })))}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Account ID</TableHead>
                      <TableHead>Moeda</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discovered.map(a => (
                      <TableRow key={a.account_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={a.selected}
                            disabled={!a.name}
                            onChange={() =>
                              setDiscovered(d =>
                                d.map(x =>
                                  x.account_id === a.account_id ? { ...x, selected: !x.selected } : x,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {a.name ?? <span className="text-destructive text-xs">— não resolvido</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.account_id}</TableCell>
                        <TableCell>
                          <Badge variant={a.currency === "USD" ? "default" : "outline"}>{a.currency}</Badge>
                        </TableCell>
                        <TableCell>
                          {a.error
                            ? <Badge variant="destructive" title={a.error}>Erro Graph</Badge>
                            : a.already_registered
                              ? <Badge variant="secondary">Atualizar token</Badge>
                              : <Badge variant="outline">Nova</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Button onClick={handleBulkCreate} disabled={pending || selectedCount === 0}>
                  {pending
                    ? "Salvando…"
                    : selectedNewCount > 0 && selectedUpdateCount > 0
                      ? `Cadastrar ${selectedNewCount} + atualizar token de ${selectedUpdateCount}`
                      : selectedUpdateCount > 0
                        ? `Atualizar token de ${selectedUpdateCount} conta(s)`
                        : `Cadastrar ${selectedNewCount} conta(s)`}
                </Button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div><Label>BM ID</Label><Input name="bm_id" required /></div>
            <div><Label>Account ID</Label><Input name="account_id" placeholder="sem act_" required /></div>
            <div><Label>Nome</Label><Input name="name" required /></div>
            <div className="md:col-span-2"><Label>Access Token</Label><Input name="access_token" required /></div>
            <Button type="submit" disabled={pending} className="md:col-span-5 md:w-fit">
              {pending ? "Salvando…" : "Cadastrar"}
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Moeda detectada automaticamente da Meta. Contas em USD têm o gasto
            convertido pra BRL (cotação do dia) e não somam o imposto de 12,5%.
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={handleRefreshCurrency}>
            {pending ? "Detectando…" : "Re-detectar moedas"}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead><TableHead>BM ID</TableHead><TableHead>Account ID</TableHead>
              <TableHead>Moeda</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma conta cadastrada</TableCell></TableRow>
            ) : rows.map(r => (
              <Fragment key={r.id}>
                <TableRow>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.bm_id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.account_id}</TableCell>
                  <TableCell><Badge variant={r.currency === "USD" ? "default" : "outline"}>{r.currency}</Badge></TableCell>
                  <TableCell>{r.is_active ? <Badge>Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {tokenSavedId === r.id && (
                        <span className="text-xs text-emerald-500 whitespace-nowrap">Token trocado!</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Trocar token"
                        aria-label="Trocar token"
                        onClick={() => openTokenEdit(r.id)}
                        className={tokenEditId === r.id ? "text-primary" : ""}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Apagar conta" aria-label="Apagar conta" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {tokenEditId === r.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/20">
                      <div className="flex flex-col md:flex-row gap-2 md:items-center py-1">
                        <Input
                          className="font-mono text-xs flex-1"
                          value={tokenDraft}
                          onChange={e => setTokenDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleUpdateToken(r.id); if (e.key === "Escape") { setTokenEditId(null); setTokenDraft(""); } }}
                          placeholder="Cole o novo Access Token"
                          autoFocus
                        />
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" disabled={pending || tokenDraft.trim().length === 0} onClick={() => handleUpdateToken(r.id)}>
                            {pending ? "Salvando…" : "Salvar token"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setTokenEditId(null); setTokenDraft(""); }}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Por segurança o token atual não é exibido. O novo substitui o anterior e passa a valer na hora.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AttendantsPanel({ initial }: { initial: Attendant[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = { email: fd.get("email"), name: fd.get("name") };
    startTransition(async () => {
      const res = await fetch("/api/attendants", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setRows(r => [json.data, ...r]);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar este atendente?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/attendants/${id}`, { method: "DELETE" });
      if (!res.ok) { setError("Erro ao apagar"); return; }
      setRows(r => r.filter(x => x.id !== id));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Atendentes</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Email dos afiliados cujas vendas Payt devem ser processadas. Compras de afiliados que
          NÃO estiverem aqui são ignoradas pelo webhook.
        </p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2"><Label>Email</Label><Input name="email" type="email" required /></div>
          <div><Label>Nome (opcional)</Label><Input name="name" /></div>
          <Button type="submit" disabled={pending} className="md:col-span-3 md:w-fit">
            {pending ? "Salvando…" : "Cadastrar"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Table>
          <TableHeader>
            <TableRow><TableHead>Email</TableHead><TableHead>Nome</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum atendente cadastrado</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.email}</TableCell>
                <TableCell>{r.name || "—"}</TableCell>
                <TableCell>{r.is_active ? <Badge>Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PixelsPanel({ initial }: { initial: Pixel[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      pixel_id: fd.get("pixel_id"),
      access_token: fd.get("access_token"),
      name: fd.get("name"),
      is_default: fd.get("is_default") === "on",
    };
    startTransition(async () => {
      const res = await fetch("/api/pixels", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setRows(r => {
        // Se o novo virou default, desmarca os outros localmente
        const next = body.is_default ? r.map(x => ({ ...x, is_default: false })) : r;
        return [json.data, ...next];
      });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  async function toggleDefault(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/pixels/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_default: true }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setRows(r => r.map(x => ({ ...x, is_default: x.id === id })));
      router.refresh();
    });
  }

  async function setCapiMode(id: string, capi_mode: Pixel["capi_mode"]) {
    setRows(r => r.map(x => (x.id === id ? { ...x, capi_mode } : x))); // otimista
    startTransition(async () => {
      const res = await fetch(`/api/pixels/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capi_mode }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Erro ao mudar o modo");
      }
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar este pixel?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/pixels/${id}`, { method: "DELETE" });
      if (!res.ok) { setError("Erro ao apagar"); return; }
      setRows(r => r.filter(x => x.id !== id));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Pixels</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Pixel ID</Label><Input name="pixel_id" required /></div>
          <div className="md:col-span-2"><Label>Access Token</Label><Input name="access_token" required /></div>
          <div><Label>Nome</Label><Input name="name" /></div>
          <label className="flex items-center gap-2 md:col-span-4">
            <input type="checkbox" name="is_default" className="rounded" />
            <span className="text-sm">Definir como pixel default</span>
          </label>
          <Button type="submit" disabled={pending} className="md:col-span-4 md:w-fit">
            {pending ? "Salvando…" : "Cadastrar"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Table>
          <TableHeader>
            <TableRow><TableHead>Nome</TableHead><TableHead>Pixel ID</TableHead><TableHead>Envio (CAPI)</TableHead><TableHead>Default</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum pixel cadastrado</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.pixel_id}</TableCell>
                <TableCell>
                  <select
                    value={r.capi_mode}
                    onChange={e => setCapiMode(r.id, e.target.value as Pixel["capi_mode"])}
                    disabled={pending}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="both">Venda + Agendamento</option>
                    <option value="sale">Só Venda</option>
                    <option value="schedule">Só Agendamento</option>
                    <option value="off">Desligado</option>
                  </select>
                </TableCell>
                <TableCell>
                  {r.is_default
                    ? <Badge>Default</Badge>
                    : <Button variant="ghost" size="sm" onClick={() => toggleDefault(r.id)}>Tornar default</Button>}
                </TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ProjectsPanel({
  initialProjects,
  initialAdAccounts,
  initialPixels,
  initialAttendants,
}: {
  initialProjects: Project[];
  initialAdAccounts: AdAccount[];
  initialPixels: Pixel[];
  initialAttendants: Attendant[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [accounts, setAccounts] = useState(initialAdAccounts);
  const [pixels, setPixels] = useState(initialPixels);
  const [attendants, setAttendants] = useState(initialAttendants);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    startTransition(async () => {
      const res = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro ao criar projeto"); return; }
      setProjects(p => [...p, json.data]);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function startEdit(id: string, name: string) {
    setError(null);
    setEditId(id);
    setEditName(name);
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name) { setEditId(null); return; }
    startTransition(async () => {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro ao renomear"); return; }
      setProjects(p => p.map(x => (x.id === id ? json.data : x)));
      setEditId(null);
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar este projeto? As contas, pixels e atendentes dele ficam SEM projeto (voltam pra visão “Todos”).")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) { setError("Erro ao apagar"); return; }
      const drop = (ids: string[]) => ids.filter(x => x !== id);
      setProjects(p => p.filter(x => x.id !== id));
      setAccounts(a => a.map(x => ({ ...x, project_ids: drop(x.project_ids) })));
      setPixels(px => px.map(x => ({ ...x, project_ids: drop(x.project_ids) })));
      setAttendants(at => at.map(x => ({ ...x, project_ids: drop(x.project_ids) })));
      router.refresh();
    });
  }

  // Liga/desliga a entidade num projeto (array project_ids). Manda o array
  // COMPLETO novo pro PATCH. Uma conta pode estar em vários projetos.
  function toggleProject(
    kind: "ad-accounts" | "pixels" | "attendants",
    id: string,
    current: string[],
    projectId: string,
  ) {
    setError(null);
    const next = current.includes(projectId)
      ? current.filter(x => x !== projectId)
      : [...current, projectId];
    if (kind === "ad-accounts") setAccounts(rows => rows.map(x => (x.id === id ? { ...x, project_ids: next } : x)));
    else if (kind === "pixels") setPixels(rows => rows.map(x => (x.id === id ? { ...x, project_ids: next } : x)));
    else setAttendants(rows => rows.map(x => (x.id === id ? { ...x, project_ids: next } : x)));
    startTransition(async () => {
      const res = await fetch(`/api/${kind}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_ids: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Erro ao atribuir projeto");
      }
      router.refresh();
    });
  }

  const countIn = (arr: { project_ids: string[] }[], pid: string) =>
    arr.filter(x => x.project_ids?.includes(pid)).length;

  // Chips de atribuição multi-projeto: um chip por projeto; aceso = pertence.
  // Clicar liga/desliga. Reutilizado nas 3 seções.
  function AssignChips({
    kind, id, value,
  }: {
    kind: "ad-accounts" | "pixels" | "attendants";
    id: string;
    value: string[];
  }) {
    if (projects.length === 0) {
      return <span className="text-xs text-muted-foreground">Crie um projeto acima</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {projects.map(p => {
          const on = value?.includes(p.id) ?? false;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggleProject(kind, id, value ?? [], p.id)}
              disabled={pending}
              className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors disabled:opacity-60 ${
                on
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
              title={on ? `Remover de ${p.name}` : `Adicionar a ${p.name}`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Projetos</CardTitle></CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Um projeto agrupa contas de anúncio, pixels e atendentes — pra separar
          nichos ou modalidades (ex.: pagamento antecipado × after-pay) num
          dashboard só. O seletor no topo da barra lateral troca entre eles;
          “Todos os projetos” mostra tudo agregado. Nas seções abaixo, clique nos
          chips pra ligar/desligar cada conta/pixel/atendente num projeto — a
          <strong> mesma conta pode estar em vários projetos</strong> (ela aparece
          cheia em cada um).
        </p>

        {/* Criar projeto */}
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Label>Novo projeto</Label>
            <Input name="name" placeholder="Ex.: Emagrecimento — After Pay" required />
          </div>
          <Button type="submit" disabled={pending} className="sm:w-fit">
            {pending ? "Salvando…" : "Criar projeto"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Lista de projetos */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Projeto</TableHead>
              <TableHead className="text-center">Contas</TableHead>
              <TableHead className="text-center">Pixels</TableHead>
              <TableHead className="text-center">Atendentes</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum projeto — crie o primeiro acima.</TableCell></TableRow>
            ) : projects.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {editId === p.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleRename(p.id); if (e.key === "Escape") setEditId(null); }}
                        className="h-8 max-w-[240px]"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => handleRename(p.id)} disabled={pending}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancelar</Button>
                    </div>
                  ) : (
                    <button className="hover:underline text-left" onClick={() => startEdit(p.id, p.name)} title="Renomear">
                      {p.name}
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-center font-mono text-xs">{countIn(accounts, p.id)}</TableCell>
                <TableCell className="text-center font-mono text-xs">{countIn(pixels, p.id)}</TableCell>
                <TableCell className="text-center font-mono text-xs">{countIn(attendants, p.id)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)} title="Apagar projeto">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Atribuição — Contas */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Contas de anúncio</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Conta</TableHead><TableHead>Account ID</TableHead><TableHead>Projeto</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma conta cadastrada</TableCell></TableRow>
              ) : accounts.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="font-mono text-xs">{a.account_id}</TableCell>
                  <TableCell><AssignChips kind="ad-accounts" id={a.id} value={a.project_ids} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Atribuição — Pixels */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Pixels</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Nome</TableHead><TableHead>Pixel ID</TableHead><TableHead>Projeto</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {pixels.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhum pixel cadastrado</TableCell></TableRow>
              ) : pixels.map(px => (
                <TableRow key={px.id}>
                  <TableCell className="font-medium">{px.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{px.pixel_id}</TableCell>
                  <TableCell><AssignChips kind="pixels" id={px.id} value={px.project_ids} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Atribuição — Atendentes */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Atendentes</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Email</TableHead><TableHead>Nome</TableHead><TableHead>Projeto</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {attendants.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhum atendente cadastrado</TableCell></TableRow>
              ) : attendants.map(at => (
                <TableRow key={at.id}>
                  <TableCell className="font-mono text-xs">{at.email}</TableCell>
                  <TableCell>{at.name || "—"}</TableCell>
                  <TableCell><AssignChips kind="attendants" id={at.id} value={at.project_ids} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// Data de hoje no fuso de São Paulo, formato YYYY-MM-DD (en-CA já entrega assim).
function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
// YYYY-MM-DD → DD/MM/YYYY pra exibição.
function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function UsdRatePanel({
  initial,
}: {
  initial: { config: UsdRateConfig; liveRate: number; dailyRates: DailyRate[] };
}) {
  const router = useRouter();
  // ── Fallback global (auto/manual) ────────────────────────────────────────
  const [mode, setMode] = useState<"auto" | "manual">(initial.config.mode);
  const [manualRate, setManualRate] = useState<string>(
    initial.config.manual_rate != null ? String(initial.config.manual_rate) : "",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Cotação por dia ──────────────────────────────────────────────────────
  const [days, setDays] = useState<DailyRate[]>(initial.dailyRates);
  const [dayDate, setDayDate] = useState<string>(todayInSaoPaulo());
  const [dayRate, setDayRate] = useState<string>("");
  const [dayError, setDayError] = useState<string | null>(null);

  // Cotação ao vivo é apenas referência (não muda após o carregamento da página).
  const liveRate = initial.liveRate;

  function handleSaveFallback(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (mode === "manual") {
      const r = Number(manualRate.replace(",", "."));
      if (!Number.isFinite(r) || r <= 0) {
        setError("Informe um valor de cotação válido (maior que zero).");
        return;
      }
    }

    startTransition(async () => {
      const res = await fetch("/api/settings/usd-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          manual_rate: mode === "manual" ? Number(manualRate.replace(",", ".")) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro ao salvar"); return; }
      if (json.config?.manual_rate != null) setManualRate(String(json.config.manual_rate));
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  }

  function handleSaveDay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDayError(null);

    const r = Number(dayRate.replace(",", "."));
    if (!dayDate) { setDayError("Escolha uma data."); return; }
    if (!Number.isFinite(r) || r <= 0) {
      setDayError("Informe um valor de cotação válido (maior que zero).");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/settings/usd-rate/daily", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dayDate, rate: r }),
      });
      const json = await res.json();
      if (!res.ok) { setDayError(json.error || "Erro ao salvar"); return; }
      const savedDay = json.data as DailyRate;
      // Insere ou substitui a data e reordena (mais recente primeiro).
      setDays(d => {
        const rest = d.filter(x => x.date !== savedDay.date);
        return [...rest, savedDay].sort((a, b) => (a.date < b.date ? 1 : -1));
      });
      setDayRate("");
      router.refresh();
    });
  }

  function handleDeleteDay(date: string) {
    setDayError(null);
    startTransition(async () => {
      const res = await fetch(`/api/settings/usd-rate/daily?date=${date}`, { method: "DELETE" });
      if (!res.ok) { setDayError("Erro ao apagar"); return; }
      setDays(d => d.filter(x => x.date !== date));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Cotação do dólar (USD→BRL)</CardTitle></CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Converte o gasto das contas de anúncio em dólar pra BRL no dashboard.
          O cálculo usa a cotação <strong>do próprio dia</strong> do gasto; dias
          sem cotação preenchida caem no <strong>fallback global</strong> abaixo.
        </p>

        {/* ── Cotação por dia ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Cotação por dia</h3>
          <p className="text-xs text-muted-foreground">
            Preencha a cotação de cada dia. O gasto de cada data é convertido pela
            taxa daquela data. Cotação ao vivo de referência agora:{" "}
            <Badge variant="outline">R$ {liveRate.toFixed(4)}</Badge>
          </p>
          <form onSubmit={handleSaveDay} className="grid grid-cols-1 md:grid-cols-[180px_180px_auto] gap-3 items-end">
            <div>
              <Label>Data</Label>
              <Input type="date" value={dayDate} max={todayInSaoPaulo()} onChange={e => setDayDate(e.target.value)} />
            </div>
            <div>
              <Label>Cotação (R$ por US$ 1)</Label>
              <Input type="text" inputMode="decimal" value={dayRate} onChange={e => setDayRate(e.target.value)} placeholder="Ex.: 5.50" />
            </div>
            <Button type="submit" disabled={pending} className="md:w-fit">
              {pending ? "Salvando…" : "Salvar dia"}
            </Button>
          </form>
          {dayError && <p className="text-sm text-destructive">{dayError}</p>}

          <Table>
            <TableHeader>
              <TableRow><TableHead>Data</TableHead><TableHead>Cotação</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {days.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma cotação diária — tudo usa o fallback global</TableCell></TableRow>
              ) : days.map(d => (
                <TableRow key={d.date}>
                  <TableCell className="font-mono text-xs">{formatDateBR(d.date)}</TableCell>
                  <TableCell>R$ {Number(d.rate).toFixed(4)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => handleDeleteDay(d.date)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <div className="h-px bg-border/60" />

        {/* ── Fallback global ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Fallback global</h3>
          <p className="text-xs text-muted-foreground">
            Usado nos dias sem cotação específica acima. No automático vem ao vivo
            da AwesomeAPI; no manual você trava um valor fixo.
          </p>
          <form onSubmit={handleSaveFallback} className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="usd-mode"
                  className="mt-1"
                  checked={mode === "auto"}
                  onChange={() => setMode("auto")}
                />
                <span className="text-sm">
                  <span className="font-medium">Automático</span>
                  <span className="block text-xs text-muted-foreground">
                    Usa a cotação ao vivo (atualizada no máximo 1×/hora).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="usd-mode"
                  className="mt-1"
                  checked={mode === "manual"}
                  onChange={() => setMode("manual")}
                />
                <span className="text-sm">
                  <span className="font-medium">Manual</span>
                  <span className="block text-xs text-muted-foreground">
                    Trava um valor fixo até você alterar de novo.
                  </span>
                </span>
              </label>
            </div>

            {mode === "manual" && (
              <div className="max-w-[220px]">
                <Label>Valor da cotação (R$ por US$ 1)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={manualRate}
                  onChange={e => setManualRate(e.target.value)}
                  placeholder="Ex.: 5.50"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending} className="md:w-fit">
                {pending ? "Salvando…" : "Salvar fallback"}
              </Button>
              {saved && <span className="text-sm text-emerald-500">Salvo!</span>}
              {error && <span className="text-sm text-destructive">{error}</span>}
            </div>
          </form>
        </section>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// Botão de copiar com feedback "Copiado!" (volta ao normal após 2s).
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (contexto não-seguro) — ignora silenciosamente.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
      {copied ? "Copiado!" : "Copiar"}
    </Button>
  );
}

// URL com botão de copiar — layout reutilizado pelos dois webhooks.
function WebhookUrl({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all rounded-md border border-input bg-muted/40 px-3 py-2 text-xs font-mono">
        {url}
      </code>
      <CopyButton value={url} />
    </div>
  );
}

// Secret aleatório URL-safe (48 hex) gerado no browser.
function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function SecretSourceBadge({ source }: { source: "painel" | "env" | null }) {
  if (source === "painel") return <Badge variant="outline">definido no painel</Badge>;
  if (source === "env") return <Badge variant="secondary">vindo da Vercel (env var)</Badge>;
  return <Badge variant="destructive">não configurado</Badge>;
}

// Editor de um secret de webhook: mostra o valor atual (com copiar), permite
// digitar/gerar um novo e salvar via /api/settings/webhook-secrets.
function SecretEditor({
  label,
  secretKey,
  secret,
  onSaved,
}: {
  label: string;
  secretKey: "datacrazy" | "payt" | "skale" | "braip";
  secret: WebhookSecrets["datacrazy"];
  onSaved: (s: WebhookSecrets) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch("/api/settings/webhook-secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [secretKey]: draft }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro ao salvar"); return; }
      onSaved(json as WebhookSecrets);
      setDraft("");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  }

  return (
    <div className="rounded-md border border-input p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        <SecretSourceBadge source={secret.source} />
      </div>
      {secret.value ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded-md border border-input bg-muted/40 px-3 py-2 text-xs font-mono">
            {secret.value}
          </code>
          <CopyButton value={secret.value} />
        </div>
      ) : (
        <p className="text-xs text-destructive">
          Nenhum secret configurado — o webhook rejeita tudo com 401 até você salvar um.
        </p>
      )}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <Input
          className="font-mono text-xs"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Novo secret (8–128 caracteres: letras, números, - e _)"
        />
        <div className="flex gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(randomSecret())}>
            <RefreshCw className="h-4 w-4 mr-1" />Gerar
          </Button>
          <Button type="button" size="sm" disabled={pending || draft.trim().length === 0} onClick={handleSave}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
      {saved && (
        <p className="text-xs text-emerald-500">
          Salvo! Atualize também a plataforma que envia o webhook — o valor antigo já não é aceito.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function WebhooksPanel({ baseUrl, initialSecrets }: { baseUrl: string; initialSecrets: WebhookSecrets }) {
  const [secrets, setSecrets] = useState<WebhookSecrets>(initialSecrets);

  const leadsUrl = `${baseUrl}/api/webhook/datacrazy`;
  const salesUrl = `${baseUrl}/api/webhook/payt?token=${secrets.payt.value ?? "SEU_PAYT_WEBHOOK_SECRET"}`;
  const skaleUrl = `${baseUrl}/api/webhook/skale?token=${secrets.skale.value ?? "SEU_SKALE_WEBHOOK_SECRET"}`;
  // Braip autentica pelo basic_authentication NO CORPO do postback (não query/header),
  // então a URL é só o endpoint — o secret é a chave que a Braip envia em cada postback.
  const braipUrl = `${baseUrl}/api/webhook/braip`;

  const leadsPayload = `{
  "phone": "5511999998888",
  "ctwa_clid": "ARAbc123...",
  "source_id": "120210000000000000",
  "source_url": "https://wa.me/...",
  "page_id": "100000000000000"
}`;

  const salesPayloadLuminar = `{
  "integration_key": "luminar-pay",
  "seller_id": "luminar-pay",
  "status": "paid",
  "transaction_id": "cmpoj1ddi0001l5046ls5mk77",
  "customer": {
    "name": "Antonio Henrique Neto",
    "email": "cliente@email.com",
    "phone": "83991692533",
    "billing_address": {
      "zipcode": "58000000", "city": "João Pessoa",
      "estate": "PB", "country": "BR"
    }
  },
  "transaction": { "net_profit": 41290, "payment_status": "paid" }
}`;

  const salesPayloadSkale = `{
  "transaction_id": "ven_8832",
  "customer": {
    "name": "Maria Silva", "email": "cliente@email.com",
    "phone": "11999999999",
    "address": { "zip_code": "01001000", "city": "São Paulo", "state": "SP" }
  },
  "product": { "name": "Kit Exemplo", "code": "147" },
  "transaction": {
    "payment_method": "After Pay",
    "payment_status": "Aguardando Pagamento",
    "total_price": 69900, "paid_at": null
  },
  "skaletracking": { "event": "order_created" }
}`;

  const salesPayloadBraip = `{
  "basic_authentication": "SEU_SECRET_DA_BRAIP",
  "type": "STATUS_ALTERADO",
  "trans_key": "venrw415k",
  "trans_status_code": "11",
  "trans_status": "Agendado",
  "trans_payment": "6",
  "trans_pay_on_delivery": 1,
  "trans_value": "69900",
  "product_name": "Kit Exemplo",
  "client_name": "Maria Silva",
  "client_email": "cliente@email.com",
  "client_cel": "11999999999",
  "client_address_city": "São Paulo",
  "client_address_state": "SP",
  "client_zip_code": "01001000"
}`;

  return (
    <Card>
      <CardHeader><CardTitle>Webhooks</CardTitle></CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          URLs, secrets e formatos de payload dos webhooks do sistema. Copie a URL
          e o secret direto daqui ao configurar cada plataforma — dá pra trocar o
          secret sem mexer na Vercel (a alteração vale na hora).
        </p>

        {/* ── Webhook de Leads (DataCrazy) ─────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Webhook de Leads (DataCrazy / WhatsApp)</h3>
            <Badge variant="outline">POST</Badge>
          </div>
          <WebhookUrl url={leadsUrl} />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Autenticação:</strong> header{" "}
              <code className="font-mono">x-datacrazy-secret</code> com o secret
              abaixo. Requisição sem o header correto → <code>401</code>.
            </p>
          </div>
          <SecretEditor
            label="Secret do DataCrazy (valor do header x-datacrazy-secret)"
            secretKey="datacrazy"
            secret={secrets.datacrazy}
            onSaved={setSecrets}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Payload esperado</span>
              <CopyButton value={leadsPayload} />
            </div>
            <pre className="rounded-md border border-input bg-muted/40 p-3 text-xs font-mono overflow-x-auto">
              {leadsPayload}
            </pre>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
            <li><code className="font-mono">phone</code> — telefone do lead (obrigatório; sem ele o payload é ignorado).</li>
            <li><code className="font-mono">ctwa_clid</code> — click ID do anúncio Click-to-WhatsApp. Só dispara o evento Lead no CAPI se presente.</li>
            <li><code className="font-mono">source_id</code> — ID do anúncio/criativo; resolve campanha/conjunto/anúncio via Graph API.</li>
            <li><code className="font-mono">source_url</code> — URL de origem; vira <code>event_source_url</code> no CAPI.</li>
            <li><code className="font-mono">page_id</code> — Facebook Page ID que veicula o CTWA.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Os campos também são aceitos aninhados em <code>referral</code>,{" "}
            <code>message.referral</code> ou <code>metadata</code>.
          </p>
        </section>

        <div className="h-px bg-border/60" />

        {/* ── Webhook de Vendas (Payt + Luminar-pay) ───────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Webhook de Vendas (Payt + Luminar-pay)</h3>
            <Badge variant="outline">POST</Badge>
          </div>
          <WebhookUrl url={salesUrl} />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Autenticação:</strong> o secret vai na{" "}
              <strong>query string</strong> (<code className="font-mono">?token=…</code>, já
              incluído na URL acima), porque a Payt não permite header customizado
              no postback.
            </p>
            <p>
              <strong>Payt e Luminar-pay usam a MESMA URL.</strong> O sistema
              detecta a plataforma pelo payload.
            </p>
          </div>
          <SecretEditor
            label="Secret da Payt / Luminar-pay (parâmetro ?token= da URL)"
            secretKey="payt"
            secret={secrets.payt}
            onSaved={setSecrets}
          />
          <div className="rounded-md border border-input bg-muted/40 p-3 text-xs space-y-2">
            <p className="font-medium">Qual campo vira o valor da venda:</p>
            <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
              <li>
                <strong>Payt:</strong> valor do item <code className="font-mono">producer</code> no
                array <code className="font-mono">commission</code> (líquido, após taxas).
              </li>
              <li>
                <strong>Luminar-pay:</strong> <code className="font-mono">transaction.net_profit</code>{" "}
                (em centavos). Identificada por{" "}
                <code className="font-mono">integration_key</code>/<code className="font-mono">seller_id</code>{" "}
                == <code className="font-mono">&quot;luminar-pay&quot;</code>.
              </li>
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Payload de exemplo (Luminar-pay)</span>
              <CopyButton value={salesPayloadLuminar} />
            </div>
            <pre className="rounded-md border border-input bg-muted/40 p-3 text-xs font-mono overflow-x-auto">
              {salesPayloadLuminar}
            </pre>
          </div>
        </section>

        <div className="h-px bg-border/60" />

        {/* ── Webhook do Skale Tracking (Pay After Delivery) ────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Webhook do Skale Tracking (Pay After Delivery)</h3>
            <Badge variant="outline">POST</Badge>
          </div>
          <WebhookUrl url={skaleUrl} />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Autenticação:</strong> o secret vai na{" "}
              <strong>query string</strong> (<code className="font-mono">?token=…</code>, já
              incluído na URL acima), ou no header{" "}
              <code className="font-mono">x-skale-secret</code>.
            </p>
            <p>
              <strong>Agendamento:</strong> pedido <code className="font-mono">order_created</code>{" "}
              com <code className="font-mono">payment_method: &quot;After Pay&quot;</code> entra como{" "}
              <strong>agendamento</strong> (coluna AGENDAMENTO), atribuído por telefone,{" "}
              <strong>sem</strong> disparar Purchase no Meta. Quando o pagamento confirmar
              depois, vira venda e aí sim dispara o Purchase.
            </p>
          </div>
          <SecretEditor
            label="Secret do Skale (parâmetro ?token= da URL)"
            secretKey="skale"
            secret={secrets.skale}
            onSaved={setSecrets}
          />
          <div className="rounded-md border border-input bg-muted/40 p-3 text-xs space-y-2">
            <p className="font-medium">Como o Skale é lido:</p>
            <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
              <li>O evento vem em <code className="font-mono">skaletracking.event</code> (o <code className="font-mono">status</code> de topo é o de <strong>entrega</strong>).</li>
              <li><strong>Valor:</strong> <code className="font-mono">transaction.total_price</code> (em centavos).</li>
              <li><strong>Telefone:</strong> <code className="font-mono">customer.phone</code> (o DDI 55 é adicionado automaticamente).</li>
              <li><strong>Pago:</strong> <code className="font-mono">payment_confirmed</code> / <code className="font-mono">payment_registered</code> / <code className="font-mono">order_paid_manual</code> / <code className="font-mono">paid_at</code> preenchido → vira venda + Purchase.</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Payload de exemplo (agendamento)</span>
              <CopyButton value={salesPayloadSkale} />
            </div>
            <pre className="rounded-md border border-input bg-muted/40 p-3 text-xs font-mono overflow-x-auto">
              {salesPayloadSkale}
            </pre>
          </div>
        </section>

        {/* ── Webhook da Braip (venda + pagamento na entrega) ──────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Webhook da Braip</h3>
            <Badge variant="outline">POST</Badge>
          </div>
          <WebhookUrl url={braipUrl} />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Autenticação:</strong> a Braip manda o campo{" "}
              <code className="font-mono">basic_authentication</code> <strong>no corpo</strong> de
              cada postback — cole aqui embaixo a mesma chave que aparece na configuração do
              postback na Braip. (A URL não leva <code className="font-mono">?token=</code>.)
            </p>
            <p>
              <strong>Agendamento:</strong> venda com{" "}
              <code className="font-mono">trans_pay_on_delivery: 1</code> /{" "}
              <code className="font-mono">trans_cash_on_delivery: true</code> ou status{" "}
              <code className="font-mono">Agendado</code> entra como <strong>agendamento</strong>{" "}
              (coluna AGENDAMENTO), atribuído por telefone, sem Purchase no Meta. Quando o
              pagamento confirmar (<code className="font-mono">Pagamento Aprovado</code>), vira
              venda e dispara o Purchase.
            </p>
          </div>
          <SecretEditor
            label="Secret da Braip (campo basic_authentication do postback)"
            secretKey="braip"
            secret={secrets.braip}
            onSaved={setSecrets}
          />
          <div className="rounded-md border border-input bg-muted/40 p-3 text-xs space-y-2">
            <p className="font-medium">Como a Braip é lida:</p>
            <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
              <li>Transação: <code className="font-mono">trans_key</code>; status: <code className="font-mono">trans_status_code</code> (2 = pago, 11 = agendado, 3/4/5 = cancelado/estorno).</li>
              <li><strong>Valor:</strong> comissão do produtor (senão <code className="font-mono">trans_value</code>), em centavos.</li>
              <li><strong>Telefone:</strong> <code className="font-mono">client_cel</code> (o DDI 55 é adicionado automaticamente).</li>
              <li>Postbacks <code className="font-mono">STATUS_ALTERADO</code>, <code className="font-mono">BOLETO_ALTERADO</code> e <code className="font-mono">DELIVERY_RESCHEDULED</code>.</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Payload de exemplo (agendamento)</span>
              <CopyButton value={salesPayloadBraip} />
            </div>
            <pre className="rounded-md border border-input bg-muted/40 p-3 text-xs font-mono overflow-x-auto">
              {salesPayloadBraip}
            </pre>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
