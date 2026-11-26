import type { Movement } from "../../src/domain/movements.ts";
import { ApiError } from "../lib/api.ts";
import type { CreateFixedResult, FixedFormValues } from "./fixed-form-model.ts";

export type FixedNotice = {
  tone: "ok" | "warn";
  title: string;
  body: string;
};

/**
 * form: despesa aprovada, abre o formulário.
 * record: saída do banco já confirmada que conta nos totais sem estar registrada;
 *   abre o formulário e registra o movimento ao criar a conta fixa.
 * pending: saída em "A conferir", leva à aprovação.
 * confirming: saída agendada (data de hoje em diante) que o banco ainda confirma.
 */
export type RowAction = "form" | "record" | "pending" | "confirming";
type RowShape = Pick<
  Movement,
  "id" | "kind" | "amount" | "review" | "scheduled" | "blocked" | "bankVersion" | "cardLabel"
>;

const EXPENSE_KINDS = ["expense", "fee", "card_purchase"];
const FREQUENCIES: FixedFormValues["frequency"][] = [
  "month",
  "week",
  "year",
  "custom",
];
const UNITS: FixedFormValues["unit"][] = ["day", "week", "month"];

/** Só despesa aprovada vira conta fixa; saída ainda não aprovada leva à aprovação ou ao aviso de espera. */
export function rowAction(row: RowShape): RowAction | null {
  if (row.id.startsWith("event:"))
    return EXPENSE_KINDS.includes(row.kind ?? "") ? "form" : null;
  if (BigInt(row.amount) >= 0n) return null;
  if (row.review) return "pending";
  const recordable =
    row.id.startsWith("bankpending:") &&
    (row.kind === "expense" || row.cardLabel !== undefined) &&
    !row.scheduled &&
    !row.blocked &&
    row.bankVersion !== undefined;
  return recordable ? "record" : "confirming";
}

/** Campos de um <form> (Object.fromEntries do FormData) para os valores do modelo. */
export function valuesFromForm(raw: Record<string, unknown>): FixedFormValues {
  const text = (key: string): string => {
    const value = raw[key];
    return typeof value === "string" ? value : "";
  };
  return {
    label: text("label"),
    frequency: FREQUENCIES.find((f) => f === text("frequency")) ?? "month",
    every: text("every"),
    unit: UNITS.find((u) => u === text("unit")) ?? "month",
    amount: text("amount"),
    startDate: text("start_date"),
    categoryId: text("category_id"),
    since: text("since_month"),
    endDate: text("end_date"),
  };
}

/** O servidor recusa com o id da conta fixa quando a transação já faz parte de uma. */
export function isAlreadyInSeries(error: unknown): boolean {
  return (
    error instanceof ApiError && typeof error.body.recurrence_id === "string"
  );
}

export function createdNotice(
  result: Extract<CreateFixedResult, { recurrence_id: string }>,
  next: string,
): FixedNotice {
  const tail = next ? ` Próximas: ${next}.` : "";
  if (!result.source_linked)
    return {
      tone: "warn",
      title: "Criada, com um aviso",
      body: `Esta transação não entrou como a primeira, porque a conta começa em outro dia.${tail}`,
    };
  return {
    tone: "ok",
    title: "Pronto, virou conta fixa",
    body: `Esta transação já conta como a primeira.${tail}`,
  };
}
