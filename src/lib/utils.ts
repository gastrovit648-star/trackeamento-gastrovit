import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, toZonedTime } from "date-fns-tz";

export const TIMEZONE = "America/Sao_Paulo";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDateSP(date: Date | string, fmt: string = "dd/MM/yyyy HH:mm"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const zoned = toZonedTime(d, TIMEZONE);
  return format(zoned, fmt, { timeZone: TIMEZONE });
}

export function calcROAS(revenue: number, spend: number): number {
  if (spend === 0) return 0;
  return revenue / spend;
}

// Chave de agrupamento de criativo a partir do nome do anúncio: trim + espaços
// colapsados + lowercase. Usada no ranking (rankCreatives, server) E no
// deep-link ranking → árvore de Campanhas (client), por isso mora aqui em utils
// (client-safe) e não em queries.ts, que puxa código server-only.
export function creativeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
