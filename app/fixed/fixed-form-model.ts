import { cents } from "../../src/domain/finance.ts";
import { plainMoney } from "../../src/domain/format.ts";
import {
  nthOccurrence,
  occurrencesBetween,
  type Frequency,
  type RecurrenceRule,
} from "../../src/domain/recurrence.ts";
import { movementTitle, type Movement } from "../../src/domain/movements.ts";

export type FrequencyChoice = "month" | "week" | "year" | "custom";
export type CustomUnit = "day" | "week" | "month";

export type FixedFormValues = {
  label: string;
  frequency: FrequencyChoice;
  every: string;
  unit: CustomUnit;
  amount: string;
  startDate: string;
  categoryId: string;
  /** "Desde" (YYYY-MM), vazio = só a partir do início. Meses antes do início entram como pagos. */
  since?: string;
  /** Último dia da conta fixa (YYYY-MM-DD), vazio = sem fim. */
  endDate?: string;
};

export type FixedOrigin = {
  eventId: string;
  /** Leitura do banco ainda não registrada: o formulário a registra antes de criar. */
  bank?: { id: string; version: number; kind: "card_purchase" | "expense" };
  description: string;
  /** Nome exibido (apelido quando existe); description segue como chave. */
  title: string;
  account: string;
  date: string;
  values: FixedFormValues;
};

export type FixedFormErrors = Partial<
  Record<"label" | "amount" | "every" | "startDate" | "since" | "endDate", string>
>;

export type FixedPayload = {
  event_id: string;
  frequency: Frequency;
  every: number;
  start_date: string;
  expected_cents: number;
  label: string;
  category_id?: string;
  confirm?: boolean;
  since_month?: string;
  end_date?: string;
};

export type FixedConflict = { recurrence_id: string; label: string };
export type CreateFixedResult =
  | { conflict: FixedConflict[] }
  | { recurrence_id: string; created: number; source_linked: boolean };

const MAX_LABEL = 180;
const MAX_EVERY = 366;
const PREVIEW_COUNT = 3;

export function fixedOrigin(
  row: Pick<Movement, "id" | "description" | "account" | "date" | "category" | "amount" | "bankVersion" | "cardLabel">,
  categories: { id: string; name: string }[],
): FixedOrigin {
  const abs = BigInt(row.amount);
  const bank =
    row.id.startsWith("bankpending:") && row.bankVersion !== undefined
      ? {
          id: row.id.slice("bankpending:".length),
          version: row.bankVersion,
          kind: row.cardLabel !== undefined ? ("card_purchase" as const) : ("expense" as const),
        }
      : undefined;
  return {
    eventId: bank ? "" : row.id.slice("event:".length),
    bank,
    description: row.description,
    title: movementTitle(row),
    account: row.account,
    date: row.date,
    values: {
      label: movementTitle(row).slice(0, MAX_LABEL),
      frequency: "month",
      every: "2",
      unit: "month",
      amount: plainMoney((abs < 0n ? -abs : abs).toString()),
      startDate: row.date,
      categoryId: categories.find((c) => c.name === row.category)?.id ?? "",
    },
  };
}

export function ruleParts(
  v: FixedFormValues,
): { frequency: Frequency; every: number } | null {
  if (v.frequency !== "custom") return { frequency: v.frequency, every: 1 };
  const every = Number(v.every);
  if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY) return null;
  return { frequency: v.unit, every };
}

function isIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}

function amountCents(value: string): number | null {
  try {
    const n = cents(value);
    return n > 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
  } catch {
    return null;
  }
}

export function validateFixed(
  v: FixedFormValues,
  origin: Pick<FixedOrigin, "date">,
): FixedFormErrors {
  const errors: FixedFormErrors = {};
  const label = v.label.trim();
  if (!label || label.length > MAX_LABEL)
    errors.label = "Dê um nome para a conta fixa, com até 180 letras.";
  if (amountCents(v.amount) === null)
    errors.amount = "Digite o valor esperado, por exemplo 55,90.";
  if (ruleParts(v) === null)
    errors.every = "Use um número inteiro de 1 a 366.";
  if (!isIsoDate(v.startDate))
    errors.startDate = "Escolha a data em que a conta começa.";
  else if (v.startDate < origin.date)
    errors.startDate = "O início não pode ser antes da data da transação.";
  const since = v.since ?? "";
  if (since && (!/^\d{4}-\d{2}$/.test(since) || (isIsoDate(v.startDate) && since > v.startDate.slice(0, 7))))
    errors.since = "Escolha um mês igual ou anterior ao início.";
  const end = v.endDate ?? "";
  if (end && (!isIsoDate(end) || (isIsoDate(v.startDate) && end < v.startDate)))
    errors.endDate = "O fim não pode ser antes do início.";
  return errors;
}

export function fixedPayload(
  v: FixedFormValues,
  origin: Pick<FixedOrigin, "date" | "eventId">,
  confirm = false,
): FixedPayload | null {
  const parts = ruleParts(v);
  const expected = amountCents(v.amount);
  if (Object.keys(validateFixed(v, origin)).length || !parts || !expected)
    return null;
  return {
    event_id: origin.eventId,
    frequency: parts.frequency,
    every: parts.every,
    start_date: v.startDate,
    expected_cents: expected,
    label: v.label.trim(),
    ...(v.categoryId ? { category_id: v.categoryId } : {}),
    ...(confirm ? { confirm: true } : {}),
    ...(v.since && v.since < v.startDate.slice(0, 7) ? { since_month: v.since } : {}),
    ...(v.endDate ? { end_date: v.endDate } : {}),
  };
}

/** Próximas datas depois da transação de origem, pelo mesmo calendário do servidor. */
export function nextDates(
  v: FixedFormValues,
  origin: Pick<FixedOrigin, "date">,
): string[] {
  const parts = ruleParts(v);
  if (!parts || !isIsoDate(v.startDate)) return [];
  const rule: RecurrenceRule = {
    ...parts,
    startDate: v.startDate,
    endDate: null,
    dateRule: "exact",
    planningOffset: 0,
  };
  return occurrencesBetween(rule, origin.date, nthOccurrence(rule, PREVIEW_COUNT))
    .filter((date) => date > origin.date)
    .slice(0, PREVIEW_COUNT);
}

export function formatNext(dates: string[], withYear: boolean): string {
  return dates
    .map((d) => {
      const [y, m, day] = d.split("-");
      return withYear ? `${day}/${m}/${y}` : `${day}/${m}`;
    })
    .join(", ");
}

export function nextText(v: FixedFormValues, origin: Pick<FixedOrigin, "date">): string {
  const dates = nextDates(v, origin);
  return dates.length ? formatNext(dates, v.frequency === "year") : "";
}
