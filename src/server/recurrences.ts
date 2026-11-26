import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { readToday } from "./projection.ts";
import { monthlyCandidates } from "../domain/projection-recurrences.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { merchantKey } from "./assisted.ts";
import {
  pairKey,
  readRecurrenceDecisions,
  readSpendHistory,
  readable,
} from "./projection-reads-recurrences.ts";

// Contas fixas marcadas pela pessoa, conta por conta. "Sim" (confirm) vira
// conta prevista na data dela em todas as telas, mesmo com categoria variável;
// "Não" (dismiss) nunca vira; sem decisão vale a regra da categoria fixa.

export type RecurringAccount = {
  scope: string;
  merchant_key: string;
  label: string;
  account: string | null;
  cents: string;
  day: number;
  months: number;
  category: string | null;
  category_id: string | null;
  account_id: string | null;
  decision: "confirm" | "dismiss" | null;
  /** Compra parcelada no cartão (parcela mais recente vista): já entra na fatura, não é conta fixa. */
  installments: { current: number; total: number } | null;
};

// Parcela mais recente de cada compra parcelada no cartão, por cartão e
// estabelecimento (mesma chave das sugestões).
async function readInstallments(tx: Transaction, familyId: string, from: string) {
  const { rows } = await tx.query<{ account_id: string; description: string; n: number; total: number }>(
    `SELECT e.account_id, e.description,
            (bt.card_meta->>'installment_number')::int AS n, (bt.card_meta->>'total_installments')::int AS total
       FROM economic_events e
       JOIN bank_transactions bt ON bt.household_id=e.household_id AND bt.event_id=e.id
      WHERE e.household_id=$1 AND e.cancelled_at IS NULL AND e.transaction_date>=$2::date
        AND (bt.card_meta->>'total_installments') ~ '^[0-9]+$' AND (bt.card_meta->>'installment_number') ~ '^[0-9]+$'
        AND (bt.card_meta->>'total_installments')::int > 1
      ORDER BY e.transaction_date DESC, e.id`,
    [familyId, from],
  );
  const latest = new Map<string, RecurringAccount["installments"]>();
  for (const r of rows) {
    const key = pairKey(r.account_id, merchantKey(r.description));
    if (!latest.has(key)) latest.set(key, { current: r.n, total: r.total });
  }
  return latest;
}

export async function readRecurringAccounts(
  db: Database,
  user: Identity,
  opts: { today?: string } = {},
): Promise<RecurringAccount[]> {
  return asUser(db, user.userId, async (tx) => {
    const today = opts.today ?? (await readToday(tx));
    const [history, decisions, names, installments] = await Promise.all([
      readSpendHistory(tx, user.familyId, today.slice(0, 7)),
      readRecurrenceDecisions(tx, user.familyId),
      tx.query<{ id: string; name: string; kind: "category" | "card" }>(
        `SELECT id::text,name,'category' AS kind FROM categories WHERE household_id=$1
         UNION ALL SELECT id::text,name,'card' FROM accounts WHERE household_id=$1 AND kind='card'`,
        [user.familyId],
      ),
      readInstallments(tx, user.familyId, shiftMonth(today.slice(0, 7), -3) + "-01"),
    ]);
    const nameOf = new Map(names.rows.map((r) => [r.id, r.name]));
    return monthlyCandidates(history.spends, today.slice(0, 7)).map((c) => {
      const categoryId = history.categoryByPair.get(pairKey(c.scope, c.merchant));
      return {
        scope: c.scope,
        merchant_key: c.merchant,
        label: readable(c.merchant),
        account: c.scope === "cash" ? null : (nameOf.get(c.scope) ?? null),
        cents: c.nom.toString(),
        day: c.day,
        months: c.months,
        category: categoryId ? (nameOf.get(categoryId) ?? null) : null,
        category_id: categoryId ?? null,
        account_id: c.scope === "cash" ? null : c.scope,
        decision: decisions.get(pairKey(c.scope, c.merchant)) ?? null,
        installments: c.scope === "cash" ? null : (installments.get(pairKey(c.scope, c.merchant)) ?? null),
      };
    });
  });
}

const decisionSchema = z
  .object({
    scope: z.union([z.literal("cash"), z.uuid()]),
    merchant_key: z.string().trim().min(1).max(200),
    decision: z.enum(["confirm", "dismiss"]),
  })
  .strict();

// Sempre sim ou não: a marcação muda, mas não é apagada.
export async function saveRecurrenceDecision(
  db: Database,
  user: Identity,
  raw: unknown,
) {
  canWrite(user);
  const input = decisionSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    if (input.scope !== "cash") {
      const card = await tx.query(
        "SELECT 1 FROM accounts WHERE id=$1 AND household_id=$2 AND kind='card'",
        [input.scope, user.familyId],
      );
      if (!card.rows.length) throw new UserError("Cartão não encontrado.");
    }
    await tx.query(
      `INSERT INTO recurrence_decisions(household_id,scope,merchant_key,decision,decided_by) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(household_id,scope,merchant_key) DO UPDATE SET decision=excluded.decision,decided_by=excluded.decided_by,decided_at=now()`,
      [user.familyId, input.scope, input.merchant_key, input.decision, user.userId],
    );
    await recordAudit(tx, user.familyId, user.userId, "recurrence.decision", user.familyId, {
      scope: input.scope,
      merchant_key: input.merchant_key,
      decision: input.decision,
    });
    return { decision: input.decision };
  });
}
