import { fifthBusinessDay } from "./bank-analysis.ts";

export type Frequency = "day" | "week" | "month" | "year";
export type DateRule = "exact" | "weekend_to_friday" | "fifth_business_day";
export type RecurrenceRule = {
  frequency: Frequency;
  every: number;
  startDate: string;
  endDate: string | null;
  dateRule: DateRule;
  planningOffset: 0 | 1;
};

const DAY_MS = 86_400_000;

function parseDate(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (new Date(ms).toISOString().slice(0, 10) === value) return ms;
  }
  throw new Error(`Data inválida: ${value}`);
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function assertRule(rule: RecurrenceRule): void {
  if (!Number.isInteger(rule.every) || rule.every < 1)
    throw new Error("A repetição precisa ser um inteiro maior que zero.");
  parseDate(rule.startDate);
  if (rule.endDate !== null) parseDate(rule.endDate);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function monthlyDate(start: string, monthsAhead: number): string {
  const startMs = parseDate(start);
  const s = new Date(startMs);
  const total = s.getUTCFullYear() * 12 + s.getUTCMonth() + monthsAhead;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  const day = Math.min(s.getUTCDate(), daysInMonth(year, month0));
  return fmt(Date.UTC(year, month0, day));
}

export function nthOccurrence(rule: RecurrenceRule, k: number): string {
  assertRule(rule);
  if (!Number.isInteger(k) || k < 0) throw new Error("Índice de ocorrência inválido.");
  const startMs = parseDate(rule.startDate);
  switch (rule.frequency) {
    case "day":
      return fmt(startMs + k * rule.every * DAY_MS);
    case "week":
      return fmt(startMs + 7 * k * rule.every * DAY_MS);
    case "month":
      return monthlyDate(rule.startDate, k * rule.every);
    case "year":
      return monthlyDate(rule.startDate, 12 * k * rule.every);
  }
}

function firstIndex(rule: RecurrenceRule, fromMs: number): number {
  const startMs = parseDate(rule.startDate);
  if (fromMs <= startMs) return 0;
  if (rule.frequency === "day" || rule.frequency === "week") {
    const step = (rule.frequency === "day" ? 1 : 7) * rule.every * DAY_MS;
    return Math.floor((fromMs - startMs) / step);
  }
  const s = new Date(startMs);
  const f = new Date(fromMs);
  const months = (f.getUTCFullYear() - s.getUTCFullYear()) * 12 + f.getUTCMonth() - s.getUTCMonth();
  const stride = rule.frequency === "year" ? 12 * rule.every : rule.every;
  return Math.max(0, Math.floor(months / stride) - 1);
}

export function occurrencesBetween(rule: RecurrenceRule, from: string, through: string): string[] {
  assertRule(rule);
  const lower = Math.max(parseDate(from), parseDate(rule.startDate));
  const upper = Math.min(
    parseDate(through),
    rule.endDate === null ? Infinity : parseDate(rule.endDate),
  );
  const out: string[] = [];
  for (let k = firstIndex(rule, lower); ; k++) {
    const date = nthOccurrence(rule, k);
    const ms = parseDate(date);
    if (ms > upper) break;
    if (ms >= lower) out.push(date);
  }
  return out;
}

function weekendToFriday(date: string): string {
  const ms = parseDate(date);
  const dow = new Date(ms).getUTCDay();
  if (dow === 6) return fmt(ms - DAY_MS);
  if (dow === 0) return fmt(ms - 2 * DAY_MS);
  return date;
}

export function expectedDate(rule: RecurrenceRule, occurrenceDate: string): string {
  parseDate(occurrenceDate);
  if (rule.dateRule === "weekend_to_friday") return weekendToFriday(occurrenceDate);
  if (rule.dateRule === "fifth_business_day") return fifthBusinessDay(occurrenceDate.slice(0, 7));
  return occurrenceDate;
}

// Despesa em cartão: o servidor injeta a competência da fatura; aqui só vale o mês da data prevista.
export function planningMonth(rule: RecurrenceRule, expected: string): string {
  const d = new Date(parseDate(expected));
  return fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + rule.planningOffset, 1)).slice(0, 7);
}

export function coverage(expected: string[], existing: Set<string>): "complete" | "pending" {
  return expected.every((date) => existing.has(date)) ? "complete" : "pending";
}

/**
 * Recua o início da série até a primeira data do mesmo calendário que não fica
 * antes de `from`, sem mudar o dia de referência (dia 31 não vira 28 por cair
 * num fevereiro). `from` depois do início devolve o próprio início.
 */
export function startBackTo(rule: RecurrenceRule, from: string): string {
  assertRule(rule);
  const startMs = parseDate(rule.startDate);
  const fromMs = parseDate(from);
  if (fromMs >= startMs) return rule.startDate;
  if (rule.frequency === "day" || rule.frequency === "week") {
    const step = (rule.frequency === "day" ? 1 : 7) * rule.every * DAY_MS;
    return fmt(startMs - Math.floor((startMs - fromMs) / step) * step);
  }
  const stride = rule.frequency === "year" ? 12 * rule.every : rule.every;
  const s = new Date(startMs);
  const f = new Date(fromMs);
  const months = (s.getUTCFullYear() - f.getUTCFullYear()) * 12 + s.getUTCMonth() - f.getUTCMonth();
  for (let n = Math.floor(months / stride); n > 0; n--) {
    const candidate = monthlyDate(rule.startDate, -n * stride);
    if (candidate >= from && candidate.slice(8) === rule.startDate.slice(8)) return candidate;
  }
  return rule.startDate;
}

type EditableItem = {
  planned_cents: string | null;
  label: string;
  category_id: string | null;
  due_date: string | null;
  month: string;
};

export function isManuallyEdited(item: EditableItem, generated: EditableItem): boolean {
  return (
    item.planned_cents !== generated.planned_cents ||
    item.label !== generated.label ||
    item.category_id !== generated.category_id ||
    item.due_date !== generated.due_date ||
    item.month !== generated.month
  );
}

export function isRecurring(item: { recurrence_id?: string | null }): boolean {
  return item.recurrence_id != null;
}

// Única regra de "conta fixa": entradas recorrentes nunca são contas fixas.
export function isFixedBill(item: { recurrence_id?: string | null; purpose: string }): boolean {
  return isRecurring(item) && item.purpose === "expense";
}
