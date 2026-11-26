import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { startBackTo } from "../domain/recurrence.ts";
import { brDate } from "../domain/format.ts";
import { populateSeries } from "./recurrence-backfill.ts";
import { loadRecurrence, lockRecurrences, saoPauloToday, toRule } from "./recurrence-sync.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sinceSchema = z
  .object({ recurrence_id: z.uuid(), since_month: z.string().regex(/^\d{4}-\d{2}$/), today: isoDate.optional() })
  .strict();
const amountSchema = z.object({ recurrence_id: z.uuid(), expected_cents: z.number().int().positive() }).strict();

/** "Desde quando": recua o início da conta fixa e preenche os meses que faltam. */
export async function setSince(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = sinceSchema.parse(raw);
  const today = input.today ?? saoPauloToday();
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const r = await loadRecurrence(tx, user.familyId, input.recurrence_id);
    if (r.purpose !== "expense") throw new UserError("Só conta fixa de despesa muda o início por aqui.");
    const start = startBackTo(toRule(r), `${input.since_month}-01`);
    if (start >= r.start_date)
      throw new UserError(`Escolha um mês antes de ${brDate(r.start_date)}, quando ela começa hoje.`);
    // Série que substituiu outra (mudança de valor): antes dela vale a anterior.
    const previous = (
      await tx.query<{ end_date: string | null }>(
        `SELECT p.end_date::text AS end_date FROM recurrences s JOIN recurrences p ON p.household_id=s.household_id AND p.id=s.replaces_id
          WHERE s.household_id=$1 AND s.id=$2`,
        [user.familyId, r.id],
      )
    ).rows[0];
    if (previous && (previous.end_date === null || start <= previous.end_date))
      throw new UserError("Antes do início atual esta conta tinha outro valor. Mude o valor de todas em vez de recuar o início.");
    await tx.query("UPDATE recurrences SET start_date=$3 WHERE household_id=$1 AND id=$2", [user.familyId, r.id, start]);
    const created = await populateSeries(tx, user.userId, { ...r, start_date: start }, today);
    await recordAudit(tx, user.familyId, user.userId, "recurrence.since", r.id, { from: r.start_date, to: start, created });
    return { recurrence_id: r.id, start_date: start, created };
  });
}

/**
 * "Todas": novo valor para a conta fixa e para todos os meses dela, também os
 * anteriores. Fica de fora o que tem pagamento real ligado, o pago à mão com
 * outro valor e o pulado.
 */
export async function setAmountAll(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = amountSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const r = await loadRecurrence(tx, user.familyId, input.recurrence_id);
    await tx.query("UPDATE recurrences SET expected_cents=$3 WHERE household_id=$1 AND id=$2", [user.familyId, r.id, input.expected_cents]);
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE monthly_items i
          SET planned_cents=$3,
              paid_cents=CASE WHEN i.status='done' THEN $3 ELSE i.paid_cents END,
              version=i.version+1, updated_at=now()
         FROM recurrence_occurrences o
        WHERE o.household_id=$1 AND o.recurrence_id=$2 AND o.monthly_item_id=i.id AND i.household_id=$1
          AND NOT i.archived AND i.event_id IS NULL
          AND ((i.status='open' AND i.paid_cents IS NULL)
            OR (i.status='done' AND i.paid_cents=i.planned_cents AND i.paid_date IS NOT DISTINCT FROM i.due_date))
        RETURNING i.id`,
      [user.familyId, r.id, input.expected_cents],
    );
    await recordAudit(tx, user.familyId, user.userId, "recurrence.amount_all", r.id, { expected_cents: input.expected_cents, updated: rows.length });
    return { recurrence_id: r.id, updated: rows.length };
  });
}
