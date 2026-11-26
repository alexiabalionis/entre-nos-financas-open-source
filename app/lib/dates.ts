/**
 * Datas do app no fuso de São Paulo. Origem única de `today()`/`moveMonth`,
 * que viviam copiados em family.tsx, hooks/use-month.ts e preview-mes.
 */
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Hoje como 'YYYY-MM-DD' em America/Sao_Paulo. */
export function today(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Mês atual como 'YYYY-MM' em America/Sao_Paulo. */
export function currentMonth(): string {
  return today().slice(0, 7);
}

/** Avança (n>0) ou volta (n<0) n meses a partir de 'YYYY-MM'. */
export function moveMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "novembro de 2026" para o rótulo do mês (pt-BR). */
export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(month + "-01T12:00:00Z"));
}
