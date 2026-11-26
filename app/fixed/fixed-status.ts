import { brDate } from "../../src/domain/format.ts";
import { planGroup } from "../../src/domain/dashboard.ts";
import { isFixedBill } from "../../src/domain/recurrence.ts";
import { money } from "../lib/money.ts";
import type { Tone } from "../ds/shared.ts";
import type { MonthItem } from "../hooks/use-month-data.ts";

export type FixedState =
  | "planned"
  | "paid"
  | "reconciled"
  | "awaiting"
  | "partial"
  | "card"
  | "bank";

export type StatusItem = Pick<
  MonthItem,
  | "status"
  | "event_id"
  | "paid_cents"
  | "planned_cents"
  | "due_date"
  | "candidates"
  | "currency"
> & { bank_cover?: MonthItem["bank_cover"] };

export type AmountDifference = { detail: string; chip: string; tone: Tone };

/** Item do Mês que pertence a uma série: a recorrência vem sempre preenchida. */
export type SeriesItem = MonthItem & {
  recurrence: NonNullable<MonthItem["recurrence"]>;
};

const BADGES: Record<FixedState, { tone: Tone; label: string; mark: string }> = {
  planned: { tone: "neutral", label: "Previsto", mark: "○" },
  paid: { tone: "ok", label: "Pago", mark: "✓" },
  reconciled: { tone: "ok", label: "Conciliado com o banco", mark: "✓" },
  awaiting: { tone: "warn", label: "Aguardando conferência", mark: "?" },
  partial: { tone: "warn", label: "Pago em parte", mark: "½" },
  card: { tone: "ok", label: "Na fatura do cartão", mark: "✓" },
  bank: { tone: "ok", label: "No banco", mark: "✓" },
};

/** Conta fixa = despesa que pertence a uma série; entradas da série seguem em Entradas. */
export function isSeriesBill<T extends Pick<MonthItem, "purpose" | "recurrence">>(
  item: T,
): item is T & Pick<SeriesItem, "recurrence"> {
  return isFixedBill({
    recurrence_id: item.recurrence?.id,
    purpose: item.purpose,
  });
}

/** Despesa marcada como fixa à mão, sem série: o jeito antigo, ainda no grupo Custos fixos. */
export function isLegacyFixed(
  item: Pick<MonthItem, "purpose" | "cost_type" | "recurrence">,
): boolean {
  return !isSeriesBill(item) && planGroup(item) === "fixed";
}

export function fixedState(item: StatusItem): FixedState {
  if (item.event_id) return "reconciled";
  if (item.status === "done") return "paid";
  if (item.status === "partial") return "partial";
  if (item.bank_cover) return item.bank_cover.source === "card" ? "card" : "bank";
  return item.candidates.length > 0 ? "awaiting" : "planned";
}

export function stateBadge(state: FixedState) {
  return BADGES[state];
}

/** Mesma regra do servidor: pago, parcial, conciliado ou com pagamento não deixa mexer em mês, vencimento ou pular. */
export function isRealized(item: StatusItem): boolean {
  return (
    item.status !== "open" || item.paid_cents !== null || item.event_id !== null
  );
}

/** Valor que a linha mostra: o pago quando já foi pago, senão o previsto. */
export function shownCents(item: StatusItem): string | null {
  const state = fixedState(item);
  if (item.bank_cover) return item.bank_cover.cents;
  return (state === "paid" || state === "reconciled") &&
    item.paid_cents !== null
    ? item.paid_cents
    : item.planned_cents;
}

/** Só conta paga por inteiro com valor diferente do previsto. */
export function amountDifference(
  item: StatusItem,
  hidden = false,
): AmountDifference | null {
  if (item.status !== "done") return null;
  if (item.paid_cents === null || item.planned_cents === null) return null;
  const delta = BigInt(item.paid_cents) - BigInt(item.planned_cents);
  if (delta === 0n) return null;
  const size = money(
    (delta < 0n ? -delta : delta).toString(),
    item.currency,
    hidden,
  );
  return {
    detail: `Previsto ${money(item.planned_cents, item.currency, hidden)} · pago ${money(item.paid_cents, item.currency, hidden)}`,
    chip: delta > 0n ? `+${size} a mais` : `${size} a menos`,
    tone: "warn",
  };
}

export function fixedSubtitle(
  item: StatusItem,
  today: string,
  hidden = false,
): string {
  const state = fixedState(item);
  if (item.bank_cover) {
    const when = brDate(item.bank_cover.transaction_date);
    if (state === "card") return `Compra de ${when} já está na fatura`;
    return item.bank_cover.transaction_date > today
      ? `Agendado no banco para ${when}`
      : `Saiu da conta em ${when}`;
  }
  if (state === "awaiting") {
    const found = BigInt(item.candidates[0].amount_cents);
    return `Achamos um movimento de ${money((found < 0n ? -found : found).toString(), item.currency, hidden)} no banco. Confira.`;
  }
  if (!item.due_date) return "Sem vencimento";
  if (state !== "planned") return `Vencia em ${brDate(item.due_date)}`;
  return (
    (item.due_date < today ? "Venceu em " : "Vence em ") +
    brDate(item.due_date)
  );
}
