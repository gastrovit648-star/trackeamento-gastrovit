"use client";

import { useState, useTransition, FormEvent } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";

export interface Product {
  id: string;
  product_id: string;
  name: string;
  value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Props {
  initialProducts: Product[];
}

export function ManualEventsTabs({ initialProducts }: Props) {
  // Estado compartilhado: produtos. LaunchPanel lê (pra dropdown), ProductsPanel
  // muta (CRUD). Sync em tempo real via setProducts repassado.
  const [products, setProducts] = useState(initialProducts);

  return (
    <Tabs defaultValue="launch" className="w-full">
      <TabsList>
        <TabsTrigger value="launch">Lançar venda</TabsTrigger>
        <TabsTrigger value="products">Produtos</TabsTrigger>
      </TabsList>

      <TabsContent value="launch">
        <LaunchPanel products={products.filter(p => p.is_active)} />
      </TabsContent>
      <TabsContent value="products">
        <ProductsPanel products={products} onChange={setProducts} />
      </TabsContent>
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function LaunchPanel({ products }: { products: Product[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Estado do form. Phone/email/name/geo soltos. Produto selecionado preenche
  // value automaticamente (mas o campo segue editável pra override).
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [name, setName]       = useState("");
  const [country, setCountry] = useState("BR");
  const [state, setState]     = useState("");
  const [city, setCity]       = useState("");
  const [zip, setZip]         = useState("");
  const [productKey, setProductKey] = useState<string>("");
  const [value, setValue]     = useState<string>("");

  function handleProductChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const key = e.target.value;
    setProductKey(key);
    const p = products.find(x => x.id === key);
    if (p) setValue(String(p.value));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const selectedProduct = products.find(x => x.id === productKey);
    const body = {
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      name: name.trim() || undefined,
      country: country.trim() || "BR",
      state: state.trim() || undefined,
      city: city.trim() || undefined,
      zip: zip.trim() || undefined,
      product_id: selectedProduct?.product_id ?? undefined,
      product_name: selectedProduct?.name ?? undefined,
      value: Number(value),
    };
    startTransition(async () => {
      const res = await fetch("/api/manual-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      setSuccess(`Venda registrada: ${json.transaction_id}${json.matched_lead ? " (lead matched)" : ""}`);
      // Reset minimo: limpa phone/email/name pra evitar duplo-clique acidental.
      setPhone(""); setEmail(""); setName(""); setState(""); setCity(""); setZip("");
      setProductKey(""); setValue("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lançar venda manual</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                maxLength={15}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="cliente@email.com"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Pelo menos um dos dois (telefone ou email) é obrigatório. Digite o
            telefone com 11 dígitos (DDD + 9 + 8) — o DDI +55 é adicionado
            automaticamente. Se o telefone bater com um lead existente, a
            atribuição (campanha/conjunto/anúncio) é herdada.
          </p>

          <div>
            <Label>Nome completo</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Maria Aparecida da Silva"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>País</Label>
              <Input value={country} onChange={e => setCountry(e.target.value)} maxLength={2} />
            </div>
            <div>
              <Label>Estado</Label>
              <Input
                value={state}
                onChange={e => setState(e.target.value)}
                placeholder="SP"
                maxLength={2}
              />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <div>
              <Label>CEP</Label>
              <Input value={zip} onChange={e => setZip(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Produto</Label>
              <select
                value={productKey}
                onChange={handleProductChange}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Selecione (opcional) —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.product_id} · R$ {p.value.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <Button type="submit" disabled={pending} className="md:w-fit">
            {pending ? "Registrando…" : "Registrar venda"}
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-primary">{success}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ProductsPanel({
  products,
  onChange,
}: {
  products: Product[];
  onChange: (next: Product[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      product_id: fd.get("product_id"),
      name: fd.get("name"),
      value: Number(fd.get("value")),
      is_active: fd.get("is_active") === "on",
    };
    startTransition(async () => {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      onChange([json.data, ...products]);
      (e.target as HTMLFormElement).reset();
    });
  }

  async function toggleActive(id: string, currentActive: boolean) {
    startTransition(async () => {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Erro"); return; }
      onChange(products.map(p => (p.id === id ? json.data : p)));
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar este produto?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) { setError("Erro ao apagar"); return; }
      onChange(products.filter(p => p.id !== id));
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Produtos</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Product ID</Label><Input name="product_id" required /></div>
          <div className="md:col-span-2"><Label>Nome</Label><Input name="name" required /></div>
          <div><Label>Valor (R$)</Label><Input name="value" type="number" step="0.01" min="0.01" required /></div>
          <label className="flex items-center gap-2 md:col-span-4">
            <input type="checkbox" name="is_active" defaultChecked className="rounded" />
            <span className="text-sm">Ativo (aparece no dropdown de lançamento)</span>
          </label>
          <Button type="submit" disabled={pending} className="md:col-span-4 md:w-fit">
            {pending ? "Salvando…" : "Cadastrar"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Product ID</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum produto cadastrado
                </TableCell>
              </TableRow>
            ) : products.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.product_id}</TableCell>
                <TableCell className="text-right">R$ {Number(p.value).toFixed(2)}</TableCell>
                <TableCell>
                  {p.is_active ? (
                    <Badge>Ativo</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(p.id, false)}>
                      Inativo · ativar
                    </Button>
                  )}
                  {p.is_active && (
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(p.id, true)} className="ml-2">
                      Desativar
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
