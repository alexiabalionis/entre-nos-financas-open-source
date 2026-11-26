import type { Transaction } from "@electric-sql/pglite";
import { addDays } from "../domain/day.ts";
import { WEEKS_WINDOW } from "../domain/everyday.ts";
import type {
  Obligation,
  Overspent,
  ReceiptRef,
} from "../domain/next-action.ts";
import { readRealizedSpend } from "./realized-spend.ts";
import { sumBy } from "../domain/insights.ts";

type Scope = { familyId: string; today: string };

const MIN_EXCESS = 2000n;
const WINDOW_DAYS = WEEKS_WINDOW * 7;

export type OverdueItem = Obligation & { label: string; due: string };

export async function readIncomeFlags(
  tx: Transaction,
  p: Scope,
): Promise<{ incomeDetected: boolean; receiptLate: ReceiptRef | null }> {
  const monthStart = p.today.slice(0, 7) + "-01";
  const detected = await tx.query(
    `SELECT 1 FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
     WHERE o.household_id=$1 AND r.purpose='income' AND o.match_state='detected' AND NOT i.archived
       AND o.expected_date>=$2::date AND o.expected_date<($2::date+interval '1 month')
     LIMIT 1`,
    [p.familyId, monthStart],
  );
  const late = (
    await tx.query<{ id: string; expected_date: string }>(
      `SELECT o.id,o.expected_date::text
       FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
       WHERE o.household_id=$1 AND r.purpose='income' AND NOT r.paused AND NOT i.archived AND o.match_state<>'detected'
         AND o.expected_date<=$2::date
       ORDER BY o.expected_date,o.id LIMIT 1`,
      [p.familyId, p.today],
    )
  ).rows[0];
  return {
    incomeDetected: detected.rows.length > 0,
    receiptLate: late
      ? { id: late.id, expectedDate: late.expected_date }
      : null,
  };
}

export async function readOverdue(
  tx: Transaction,
  p: Scope,
): Promise<OverdueItem[]> {
  const rows = (
    await tx.query<{
      id: string;
      label: string;
      remaining: string;
      due_date: string;
    }>(
      `SELECT id,label,(planned_cents-coalesce(paid_cents,0))::text AS remaining,due_date::text
       FROM monthly_items
       WHERE household_id=$1 AND NOT archived AND currency='BRL'
         AND purpose IN ('expense','card','benefit') AND status<>'done'
         AND planned_cents IS NOT NULL AND planned_cents>coalesce(paid_cents,0)
         AND due_date<$2::date
       ORDER BY due_date,id`,
      [p.familyId, p.today],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    amount: BigInt(r.remaining),
    due: r.due_date,
  }));
}

// Categoria sem nome fica de fora (diferente do Panorama, que a agrupa).
const byName = (rows: readonly { cents: bigint; categoryName: string | null }[]) =>
  sumBy(rows, (r) => r.categoryName || null, (r) => r.cents);

export async function readSpendProfile(
  tx: Transaction,
  p: Scope,
): Promise<{ overspent: Overspent[] }> {
  const monthStart = p.today.slice(0, 7) + "-01";
  const priorStart = addDays(monthStart, -WINDOW_DAYS);
  const rows = await readRealizedSpend(tx, {
    familyId: p.familyId,
    from: priorStart,
    to: addDays(p.today, 1),
  });

  const prior = byName(
    rows.filter((r) => r.date >= priorStart && r.date < monthStart),
  );
  const current = byName(rows.filter((r) => r.date >= monthStart));
  const elapsed = BigInt(
    Math.round(
      (Date.parse(p.today + "T12:00:00Z") -
        Date.parse(monthStart + "T12:00:00Z")) /
        86_400_000,
    ) + 1,
  );
  const overspent: Overspent[] = [];
  for (const [category, spent] of current) {
    // Base de "normal" é magnitude habitual: histórico líquido negativo vale zero.
    const baseline = prior.get(category) ?? 0n;
    const normal =
      ((baseline > 0n ? baseline : 0n) * elapsed) / BigInt(WINDOW_DAYS);
    const over = spent - normal;
    if (over >= MIN_EXCESS && spent * 10n > normal * 11n)
      overspent.push({ category, over });
  }
  overspent.sort((a, b) => (a.over < b.over ? 1 : a.over > b.over ? -1 : 0));
  return { overspent: overspent.slice(0, 3) };
}
