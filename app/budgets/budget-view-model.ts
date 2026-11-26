import type { Data } from "../hooks/use-month-data.ts";
import type { Tone } from "../ds/shared.ts";

export type BudgetRow = Data["state"]["budgets"][number];
export type BudgetState = "passou" | "vaipassar" | "perto" | "dentro";
export type Money = (cents: bigint) => string;

export type BudgetCardModel = {
  id: string;
  name: string;
  ceiling: bigint;
  spent: bigint;
  open: bigint;
  /** Quanto ainda cabe no teto contando o que já saiu e o que está previsto. */
  free: bigint;
  /** Quanto passa (ou passaria) do teto. */
  excess: bigint;
  from: string;
  state: BudgetState;
};

export const STATE_VIEW: Record<
  BudgetState,
  { order: number; tone: Tone; chip: string }
> = {
  passou: { order: 0, tone: "danger", chip: "Passou do teto" },
  vaipassar: { order: 1, tone: "warn", chip: "Vai passar" },
  perto: { order: 2, tone: "warn", chip: "Perto do teto" },
  dentro: { order: 3, tone: "ok", chip: "Dentro do teto" },
};

/** "Perto" = sobra de até 10% do teto (limite incluso). */
export function budgetState(row: BudgetRow): BudgetState {
  const ceiling = BigInt(row.planned_cents);
  if (row.over)
    return BigInt(row.spent_cents) > ceiling ? "passou" : "vaipassar";
  const left = ceiling - BigInt(row.committed_cents);
  return left * 10n <= ceiling ? "perto" : "dentro";
}

export function budgetCard(row: BudgetRow): BudgetCardModel {
  const ceiling = BigInt(row.planned_cents);
  const left = ceiling - BigInt(row.committed_cents);
  return {
    id: row.category_id,
    name: row.category_name,
    ceiling,
    spent: BigInt(row.spent_cents),
    open: BigInt(row.open_planned_cents),
    free: left > 0n ? left : 0n,
    excess: left < 0n ? -left : 0n,
    from: row.ceiling_from,
    state: budgetState(row),
  };
}

/** Passou, depois vai passar, perto e dentro; dentro do estado, por nome. */
export function sortedCards(rows: readonly BudgetRow[]): BudgetCardModel[] {
  return rows
    .map(budgetCard)
    .sort(
      (a, b) =>
        STATE_VIEW[a.state].order - STATE_VIEW[b.state].order ||
        a.name.localeCompare(b.name),
    );
}

export function uncappedCategories<T extends { id: string }>(
  categories: readonly T[],
  rows: readonly BudgetRow[],
): T[] {
  const capped = new Set(rows.map((r) => r.category_id));
  return categories.filter((c) => !capped.has(c.id));
}

export function verdictText(card: BudgetCardModel, fmt: Money): string {
  if (card.state === "passou") return `Passou ${fmt(card.excess)} do teto`;
  if (card.state === "vaipassar")
    return `Vai passar ${fmt(card.excess)} se pagar o que está previsto`;
  if (card.state === "perto") return `Sobra só ${fmt(card.free)} no teto`;
  return `Sobra ${fmt(card.free)} no teto`;
}

export function barAria(card: BudgetCardModel, fmt: Money): string {
  return `${card.name}: teto ${fmt(card.ceiling)}, já gastou ${fmt(card.spent)}, ainda vai pagar ${fmt(card.open)}, ${verdictText(card, fmt).toLowerCase()}`;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Segmentos da barra: o que cabe no teto e, à parte, o que passa dele. */
export function barSegments(card: BudgetCardModel) {
  const room = card.ceiling - card.spent;
  const parts = [
    { value: min(card.spent, card.ceiling), color: "var(--family-accent)" },
    {
      value: min(card.open, room > 0n ? room : 0n),
      color: "var(--family-accent-soft)",
    },
    { value: card.free, color: "transparent" },
    {
      value: card.excess,
      color:
        card.state === "passou" ? "var(--family-danger)" : "var(--family-warn)",
    },
  ];
  return parts
    .filter((p) => p.value > 0n)
    .map((p) => ({ value: Number(p.value), color: p.color }));
}
