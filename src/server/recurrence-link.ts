import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { plainMoney } from "../domain/format.ts";
import { checkItemTx } from "./routine.ts";
import { lockRecurrences } from "./recurrence-sync.ts";

// Liga um lançamento a uma conta fixa que já existe: escolhe a ocorrência livre
// mais perto da data do lançamento (até 45 dias) e concilia pelo mesmo caminho
// do Mês (checkItemTx), sem criar uma segunda conta fixa.

const MAX_DAYS = 45;
const schema = z.object({ event_id: z.uuid(), recurrence_id: z.uuid() }).strict();

export async function linkEventToSeries(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = schema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const event = (
      await tx.query<{ cents: string; transaction_date: string }>(
        `SELECT abs(amount_cents)::text AS cents, transaction_date::text AS transaction_date
           FROM economic_events WHERE household_id=$1 AND id=$2`,
        [user.familyId, input.event_id],
      )
    ).rows[0];
    if (!event) throw new UserError("Lançamento não encontrado.");
    const target = (
      await tx.query<{ id: string; version: number; month: string }>(
        `SELECT i.id, i.version, i.month::text AS month
           FROM recurrence_occurrences o JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
          WHERE o.household_id=$1 AND o.recurrence_id=$2 AND NOT i.archived AND i.event_id IS NULL
            AND abs(COALESCE(i.due_date, o.expected_date) - $3::date) <= $4
          ORDER BY abs(COALESCE(i.due_date, o.expected_date) - $3::date), o.occurrence_date
          LIMIT 1`,
        [user.familyId, input.recurrence_id, event.transaction_date, MAX_DAYS],
      )
    ).rows[0];
    if (!target)
      throw new UserError(
        "Esta conta fixa não tem um mês livre perto da data do lançamento. Se ela já valia nessa época, use \"Desde quando é fixa\" e tente de novo.",
      );
    await checkItemTx(tx, user, {
      id: target.id,
      version: target.version,
      status: "done",
      amount: plainMoney(event.cents),
      date: event.transaction_date,
      event_id: input.event_id,
      allow_other_account: true,
    });
    return { item_id: target.id, month: target.month };
  });
}
