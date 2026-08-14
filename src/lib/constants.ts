import {
  LayoutDashboard,
  Megaphone,
  Trophy,
  Users,
  ShoppingCart,
  Send,
  Plus,
  Settings,
} from "lucide-react";

export const TIMEZONE = "America/Sao_Paulo";
export const DEFAULT_PERIOD = "7d";

export const PERIOD_OPTIONS = [
  { label: "Hoje", value: "today" },
  { label: "Ontem", value: "yesterday" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
] as const;

export const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Campanhas", href: "/dashboard/campanhas", icon: Megaphone },
  { label: "Criativos", href: "/dashboard/criativos", icon: Trophy },
  { label: "Leads", href: "/dashboard/leads", icon: Users },
  { label: "Vendas", href: "/dashboard/vendas", icon: ShoppingCart },
  { label: "Eventos", href: "/dashboard/eventos", icon: Send },
  { label: "Eventos Manuais", href: "/dashboard/eventos-manuais", icon: Plus },
  { label: "Configurações", href: "/dashboard/configuracoes", icon: Settings },
] as const;
