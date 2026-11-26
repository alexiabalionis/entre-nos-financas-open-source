// "Saídas por categoria": junta a composição (peso de cada categoria) e o
// teto. Um número só por categoria, o comprometido do servidor (já gastou +
// ainda vai pagar), usado na barra, na lista e no teto.
import type { Data } from "../hooks/use-month-data.ts";
import { percentShares } from "../ds/chart-data.ts";
import { categoryColor } from "../month/palette.ts";
import {
  STATE_VIEW,
  sortedCards,
  type BudgetCardModel,
} from "./budget-view-model.ts";

type State = Data["state"];
export const NO_CATEGORY = "Sem categoria";

export type OutflowRowModel = {
  /** Chave estável da linha; "none" para Sem categoria. */
  key: string;
  categoryId: string | null;
  name: string;
  color: string;
  committed: bigint;
  spent: bigint;
  open: bigint;
  percent: number;
  /** Teto da categoria, quando há. */
  card: BudgetCardModel | null;
};

const URGENT = new Set(["passou", "vaipassar"]);
const urgency = (r: OutflowRowModel) =>
  r.card && URGENT.has(r.card.state) ? STATE_VIEW[r.card.state].order : 9;

/** Passou ou vai passar do teto primeiro; depois por tamanho; depois nome. */
export function outflowRows(
  state: Pick<State, "outflow" | "budgets" | "categories">,
): OutflowRowModel[] {
  const cards = new Map(sortedCards(state.budgets).map((c) => [c.id, c]));
  const names = new Map(state.categories.map((c) => [c.id, c.name]));
  const colorByName = new Map(
    state.categories.map((c) => [c.name, c.color_index ?? null]),
  );
  const seen = new Set(state.outflow.map((o) => o.category_id));
  // Categoria com teto e nada gasto ainda também aparece (com 0).
  const capped = state.budgets
    .filter((b) => !seen.has(b.category_id))
    .map((b) => ({
      category_id: b.category_id,
      spent_cents: "0",
      open_planned_cents: "0",
      committed_cents: "0",
    }));
  const base = [...state.outflow, ...capped].map((o) => {
    const name = (o.category_id && names.get(o.category_id)) || NO_CATEGORY;
    return {
      key: o.category_id ?? "none",
      categoryId: o.category_id,
      name,
      color: categoryColor(name, colorByName),
      committed: BigInt(o.committed_cents),
      spent: BigInt(o.spent_cents),
      open: BigInt(o.open_planned_cents),
      percent: 0,
      card: (o.category_id && cards.get(o.category_id)) || null,
    };
  });
  const pct = percentShares(base.map((r) => Number(r.committed)));
  return base
    .map((r, i) => ({ ...r, percent: pct[i] }))
    .sort(
      (a, b) =>
        urgency(a) - urgency(b) ||
        (a.committed > b.committed ? -1 : a.committed < b.committed ? 1 : 0) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Totais do mês, separados: "já saiu" é o mesmo número do servidor que
 * Movimentos mostra (summary.expense_cents, cartão pela fatura); "ainda vai
 * sair" é o previsto em aberto de todas as categorias.
 */
export function outflowTotals(
  state: Pick<State, "outflow" | "summary">,
): { spent: bigint; open: bigint } {
  const scheduled = state.outflow.reduce((s, o) => s + BigInt(o.scheduled_cents), 0n);
  return {
    // O agendado no banco que ainda não saiu fica em "ainda vai pagar".
    spent: BigInt(state.summary.expense_cents) - scheduled,
    open: state.outflow.reduce((s, o) => s + BigInt(o.open_planned_cents), 0n),
  };
}

/** Aria da fatia/linha: nome, parte do total e situação do teto. */
export function outflowAria(r: OutflowRowModel): string {
  const teto = r.card ? STATE_VIEW[r.card.state].chip.toLowerCase() : "sem teto";
  return `${r.name}, ${r.percent}% das saídas, ${teto}`;
}

/** Gatilho da lista fechada: quantas categorias e, se houver, quantas passaram. */
export function listSummary(rows: readonly OutflowRowModel[]): string {
  const over = rows.filter((r) => r.card && URGENT.has(r.card.state)).length;
  const base = `Ver as ${rows.length} categorias`;
  if (over === 0) return base;
  return `${base} · ${over} ${over === 1 ? "passou ou vai passar" : "passaram ou vão passar"} do teto`;
}

export const REST_KEY = "rest";
const MAIN_MAX = 5;
const MAIN_MIN_PERCENT = 5;

/**
 * Separa as categorias que aparecem de cara das pequenas, que viram "Outras".
 * Principais: as que passaram ou vão passar do teto (sempre) e as maiores,
 * até MAIN_MAX, com pelo menos MAIN_MIN_PERCENT% das saídas. Mantém a ordem.
 */
export function splitOutflow(rows: readonly OutflowRowModel[]): {
  main: OutflowRowModel[];
  rest: OutflowRowModel[];
} {
  const big = new Set(
    [...rows]
      .filter((r) => r.percent >= MAIN_MIN_PERCENT)
      .sort((a, b) => (a.committed > b.committed ? -1 : a.committed < b.committed ? 1 : 0))
      .slice(0, MAIN_MAX)
      .map((r) => r.key),
  );
  const isMain = (r: OutflowRowModel) => urgency(r) < 9 || big.has(r.key);
  const main = rows.filter(isMain);
  const rest = rows.filter((r) => !isMain(r));
  // Uma categoria sozinha em "Outras" não economiza nada: fica nas principais.
  return rest.length === 1 ? { main: [...rows], rest: [] } : { main, rest };
}

export type OutflowSegment = { key: string; label: string; value: number; color: string };

/** Fatias da barra: as principais e, se houver, uma fatia "Outras". */
export function outflowSegments(
  main: readonly OutflowRowModel[],
  rest: readonly OutflowRowModel[],
): OutflowSegment[] {
  const segs = main.map((r) => ({
    key: r.key,
    label: r.name,
    value: Number(r.committed),
    color: r.color,
  }));
  if (rest.length === 0) return segs;
  const value = rest.reduce((s, r) => s + Number(r.committed), 0);
  return [...segs, { key: REST_KEY, label: "Outras", value, color: "var(--family-track-2)" }];
}
