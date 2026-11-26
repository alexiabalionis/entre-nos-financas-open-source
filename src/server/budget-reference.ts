import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { median } from "../domain/median.ts";
import { readToday } from "./projection.ts";
import { readRealizedSpend } from "./realized-spend.ts";

// Referência para definir o teto: o gasto da categoria nos últimos 6 meses
// FECHADOS (o mês atual nunca entra). Reusa o gasto realizado de sempre
// (conta e cartão pela data da compra). Só leitura, por família.

export const REFERENCE_MONTHS = 6;
export const MIN_REFERENCE_MONTHS = 3;

export type BudgetReference = {
  median_cents: string | null;
  max_cents: string | null;
  months: { month: string; cents: string }[];
};

export type BudgetReferenceInput = { category_id: string; month: string };

const EMPTY: BudgetReference = {
  median_cents: null,
  max_cents: null,
  months: [],
};

export async function readBudgetReference(
  db: Database,
  user: Identity,
  input: BudgetReferenceInput,
  opts: { today?: string } = {},
): Promise<BudgetReference> {
  return asUser(db, user.userId, async (tx) => {
    const name = (
      await tx.query<{ name: string }>(
        "SELECT name FROM categories WHERE household_id=$1 AND id=$2",
        [user.familyId, input.category_id],
      )
    ).rows[0]?.name;
    if (name === undefined) return EMPTY;
    // Fecha no mês visto, mas nunca depois do mês atual (mês futuro ainda não
    // tem meses fechados entre hoje e ele).
    const current = (opts.today ?? (await readToday(tx))).slice(0, 7);
    const end = input.month < current ? input.month : current;
    const first = shiftMonth(end, -REFERENCE_MONTHS);
    const spend = await readRealizedSpend(tx, {
      familyId: user.familyId,
      from: first + "-01",
      to: end + "-01",
    });
    const byMonth = new Map<string, bigint>();
    for (const s of spend)
      if (s.categoryName === name) {
        const m = s.date.slice(0, 7);
        byMonth.set(m, (byMonth.get(m) ?? 0n) + s.cents);
      }
    // Conta só a partir do primeiro mês com gasto; depois, mês vazio vale 0.
    const months: { month: string; cents: bigint }[] = [];
    for (let i = 0; i < REFERENCE_MONTHS; i++) {
      const m = shiftMonth(first, i);
      const cents = byMonth.get(m) ?? 0n;
      if (months.length > 0 || cents > 0n) months.push({ month: m, cents });
    }
    const wire = months.map((m) => ({
      month: m.month,
      cents: m.cents.toString(),
    }));
    if (months.length < MIN_REFERENCE_MONTHS)
      return { ...EMPTY, months: wire };
    // Mediana e maior são magnitude habitual: mês líquido negativo vale zero
    // (a lista `months` mantém o valor com sinal).
    const values = months.map((m) => (m.cents > 0n ? m.cents : 0n));
    return {
      median_cents: median(values).toString(),
      max_cents: values.reduce((a, b) => (a > b ? a : b)).toString(),
      months: wire,
    };
  });
}
