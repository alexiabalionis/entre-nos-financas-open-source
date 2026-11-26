import type { Transaction } from "@electric-sql/pglite";
import {
  categoryOutflow,
  commitment,
  pickCeiling,
  type CeilingRow,
  type CommitmentItem,
  type OutflowRow,
  UNCATEGORIZED,
} from "../domain/budget.ts";

export type BudgetView = {
  category_id: string;
  category_name: string;
  planned_cents: string;
  spent_cents: string;
  remaining_cents: string;
  ceiling_from: string;
  open_planned_cents: string;
  committed_cents: string;
  over: boolean;
};

export type OutflowView = {
  /** null = "Sem categoria". */
  category_id: string | null;
  spent_cents: string;
  open_planned_cents: string;
  committed_cents: string;
  /** Parte do "a pagar" que é saída agendada no banco (já somada em summary.expense_cents). */
  scheduled_cents: string;
};

type MonthItem = CommitmentItem & { id: string; category_id: string | null };

// Tetos "a partir de" do mês consultado + comprometimento por categoria.
// `spending` é o realizado já calculado pelo state.ts (cartão por competência,
// pendentes automáticos); aqui só se soma o previsto em aberto dos itens.
// `outflow` traz o mesmo comprometido para TODAS as categorias com saída
// (com ou sem teto), para a barra e a lista usarem o mesmo número do teto.
// `covered`: contas fixas já pagas por uma linha do banco (fixed-bank-cover).
export async function readCommitments(
  tx: Transaction,
  familyId: string,
  month: string,
  currency: string,
  spending: ReadonlyMap<string, bigint>,
  covered: ReadonlyMap<string, object> = new Map(),
  scheduled: ReadonlyMap<string, bigint> = new Map(),
): Promise<{ budgets: BudgetView[]; outflow: OutflowView[] }> {
  const ceilings = (
    await tx.query<
      CeilingRow & { category_id: string; category_name: string }
    >(
      "SELECT b.category_id,c.name AS category_name,b.month::text,b.planned_cents::text FROM budgets b JOIN categories c ON c.household_id=b.household_id AND c.id=b.category_id WHERE b.household_id=$1 AND b.currency=$2 AND b.month<=$3::date",
      [familyId, currency, month],
    )
  ).rows;
  const items = (
    await tx.query<MonthItem>(
      "SELECT id,category_id,purpose,planned_cents::text,paid_cents::text,archived,derived,event_id,status FROM monthly_items WHERE household_id=$1 AND currency=$2 AND month=$3::date AND NOT archived",
      [familyId, currency, month],
    )
  ).rows.map((i) => ({ ...i, bank_cover: covered.get(i.id) ?? null }));
  return {
    budgets: budgetViews(ceilings, items, month, spending, scheduled),
    outflow: categoryOutflow(spending, items, scheduled).map((r) => ({
      ...outflowView(r),
      scheduled_cents: (scheduled.get(r.category_id ?? UNCATEGORIZED) ?? 0n).toString(),
    })),
  };
}

export async function readBudgets(
  tx: Transaction,
  familyId: string,
  month: string,
  currency: string,
  spending: ReadonlyMap<string, bigint>,
): Promise<BudgetView[]> {
  return (await readCommitments(tx, familyId, month, currency, spending))
    .budgets;
}

function outflowView(r: OutflowRow): Omit<OutflowView, "scheduled_cents"> {
  return {
    category_id: r.category_id,
    spent_cents: r.realized_cents.toString(),
    open_planned_cents: r.open_planned_cents.toString(),
    committed_cents: r.committed_cents.toString(),
  };
}

function budgetViews(
  ceilings: readonly (CeilingRow & {
    category_id: string;
    category_name: string;
  })[],
  items: readonly MonthItem[],
  month: string,
  spending: ReadonlyMap<string, bigint>,
  scheduled: ReadonlyMap<string, bigint> = new Map(),
): BudgetView[] {
  const byCategory = new Map<string, CeilingRow[]>();
  const names = new Map<string, string>();
  for (const r of ceilings) {
    names.set(r.category_id, r.category_name);
    byCategory.set(r.category_id, [...(byCategory.get(r.category_id) ?? []), r]);
  }
  const views: BudgetView[] = [];
  for (const [categoryId, rows] of byCategory) {
    const { ceiling_cents, from } = pickCeiling(rows, month);
    if (ceiling_cents === null || from === null) continue;
    const later = scheduled.get(categoryId) ?? 0n;
    const realized = (spending.get(categoryId) ?? 0n) - later;
    const c = commitment({
      ceiling_cents,
      realized_cents: realized,
      items: items.filter((i) => i.category_id === categoryId),
      scheduled_cents: later,
    });
    views.push({
      category_id: categoryId,
      category_name: names.get(categoryId) ?? "",
      planned_cents: ceiling_cents.toString(),
      spent_cents: realized.toString(),
      remaining_cents: (ceiling_cents - realized).toString(),
      ceiling_from: from,
      open_planned_cents: c.open_planned_cents.toString(),
      committed_cents: c.committed_cents.toString(),
      over: c.over,
    });
  }
  return views.sort((a, b) => a.category_name.localeCompare(b.category_name));
}
