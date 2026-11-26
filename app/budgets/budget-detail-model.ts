import { economicEffect } from "../../src/domain/finance.ts";
import { openPlannedCents } from "../../src/domain/budget.ts";
import { brDate } from "../../src/domain/format.ts";
import { isSeriesBill } from "../fixed/fixed-status.ts";
import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import type { Money } from "./budget-view-model.ts";

export type DetailRow = {
  key: string;
  title: string;
  sub: string;
  cents: bigint;
  fixed: boolean;
  /** Pago menos previsto, só para conta ligada ao banco com valor diferente. */
  diff: bigint | null;
  planned: bigint | null;
};

export type BudgetDetail = {
  spentRows: DetailRow[];
  upcomingRows: DetailRow[];
  upcomingTotal: bigint;
  note: { title: string; body: string } | null;
};

type DetailEvent = Pick<
  Data["state"]["events"][number],
  | "id"
  | "kind"
  | "transaction_date"
  | "description"
  | "amount_cents"
  | "currency"
  | "account_id"
  | "category_id"
>;

export type DetailLine = Data["state"]["spendingLines"][number];

export type DetailInput = {
  categoryId: string;
  currency: string;
  /** Realizado da categoria, como o servidor calculou. */
  spent: bigint;
  events: readonly DetailEvent[];
  /** Gasto que não está em `events` (cartão, pendente, automático). */
  lines: readonly DetailLine[];
  accounts: readonly { id: string; kind: string }[];
  items: readonly MonthItem[];
  fmt: Money;
};

function spentRows(input: DetailInput): DetailRow[] {
  const cards = new Set(
    input.accounts.filter((a) => a.kind === "card").map((a) => a.id),
  );
  const rows: DetailRow[] = [];
  for (const e of input.events) {
    if (e.category_id !== input.categoryId || e.currency !== input.currency)
      continue;
    if (cards.has(e.account_id)) continue;
    const cents = economicEffect(e.kind, BigInt(e.amount_cents)).expense;
    if (cents === 0n) continue;
    const item = input.items.find((i) => i.event_id === e.id);
    const planned =
      item?.planned_cents != null ? BigInt(item.planned_cents) : null;
    const diff = planned !== null && planned !== cents ? cents - planned : null;
    const date = brDate(e.transaction_date);
    const sub = !item
      ? `Gasto em ${date}`
      : diff !== null && planned !== null
        ? `Previsto ${input.fmt(planned)} · pago ${input.fmt(cents)} · ligado ao banco`
        : `Pago em ${date} · ligado ao banco`;
    rows.push({
      key: e.id,
      title: item?.label ?? e.description,
      sub,
      cents,
      fixed: item ? isSeriesBill(item) : false,
      diff: item ? diff : null,
      planned: item ? planned : null,
    });
  }
  // Compra de cartão (pela fatura), compra pendente do banco e débito
  // automático entram no gasto do servidor mas não na lista de eventos: vêm
  // em `lines`, uma por lançamento.
  const sourceLabel = {
    card: "Cartão",
    card_pending: "Cartão, ainda pendente no banco",
    auto: "Débito automático",
  } as const;
  for (const l of input.lines) {
    if (l.category_id !== input.categoryId || l.source === "scheduled") continue;
    const cents = BigInt(l.amount_cents);
    if (cents === 0n) continue;
    const where = l.account_name ? ` · ${l.account_name}` : "";
    rows.push({
      key: `${l.source}:${l.transaction_date}:${l.description}:${rows.length}`,
      title: l.description,
      sub: `${sourceLabel[l.source]}${where} · ${brDate(l.transaction_date)}`,
      cents,
      fixed: false,
      diff: null,
      planned: null,
    });
  }
  // Rede de segurança: se ainda sobrar diferença, ela aparece em vez de sumir.
  const rest = input.spent - rows.reduce((s, r) => s + r.cents, 0n);
  if (rest !== 0n)
    rows.push({
      key: "outros",
      title: "Outros ajustes",
      sub: "Diferença que não veio de um lançamento identificado",
      cents: rest,
      fixed: false,
      diff: null,
      planned: null,
    });
  return rows;
}

function upcomingRows(input: DetailInput): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const i of input.items) {
    if (i.category_id !== input.categoryId || i.currency !== input.currency)
      continue;
    const cents = openPlannedCents([{ ...i, archived: false }]);
    if (cents <= 0n) continue;
    rows.push({
      key: i.id,
      title: i.label,
      sub: i.due_date
        ? `Vence em ${brDate(i.due_date)}`
        : "Previsto para este mês",
      cents,
      fixed: isSeriesBill(i),
      diff: null,
      planned: null,
    });
  }
  // Agendado no banco que ainda não saiu: "a pagar" até o banco confirmar.
  for (const l of input.lines) {
    if (l.category_id !== input.categoryId || l.source !== "scheduled") continue;
    const cents = BigInt(l.amount_cents);
    if (cents === 0n) continue;
    const where = l.account_name ? ` · ${l.account_name}` : "";
    rows.push({
      key: `scheduled:${l.transaction_date}:${l.description}:${rows.length}`,
      title: l.description,
      sub: `Agendado${where} · sai em ${brDate(l.transaction_date)}`,
      cents,
      fixed: false,
      diff: null,
      planned: null,
    });
  }
  return rows;
}

export function diffLabel(diff: bigint, fmt: Money): string {
  return diff > 0n ? `+${fmt(diff)}` : `-${fmt(-diff)}`;
}

export function budgetDetail(input: DetailInput): BudgetDetail {
  const spent = spentRows(input);
  const upcoming = upcomingRows(input);
  const once = spent.find((r) => r.diff !== null && r.planned !== null);
  return {
    spentRows: spent,
    upcomingRows: upcoming,
    upcomingTotal: upcoming.reduce((s, r) => s + r.cents, 0n),
    note:
      once && once.planned !== null
        ? {
            title: `${once.title} aparece uma vez só`,
            body: `Estava previsto em ${input.fmt(once.planned)} e foi pago por ${input.fmt(once.cents)}. Contamos só os ${input.fmt(once.cents)} que saíram da conta. Os ${input.fmt(once.planned)} previstos deixam de contar assim que a conta é paga e ligada ao banco.`,
          }
        : null,
  };
}
