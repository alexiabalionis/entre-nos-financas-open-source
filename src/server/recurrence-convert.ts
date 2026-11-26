import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { expectedDate } from "../domain/recurrence.ts";
import { horizonEnd, insertOccurrence, lockRecurrences, syncSeries, toRule, type RecurrenceRow } from "./recurrence-sync.ts";
import { insertSeries, validateSeries } from "./recurrence-series.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const convertSchema = z
  .object({
    item_id: z.uuid(),
    version: z.number().int(),
    frequency: z.enum(["day", "week", "month", "year"]),
    every: z.number().int().min(1).max(366).default(1),
    start_date: isoDate.optional(),
    today: isoDate.optional(),
  })
  .strict();

type LegacyItem = {
  version: number;
  label: string;
  month: string;
  due_date: string | null;
  planned_cents: string | null;
  category_id: string | null;
  in_series: boolean;
  purpose: string;
  cost_type: string | null;
  derived: boolean;
};

// O item antigo vira a 1ª ocorrência: só ganha o vínculo, valor e status ficam como estão.
export async function convertLegacyItem(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const { today, ...input } = convertSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const { rows } = await tx.query<LegacyItem>(
      `SELECT i.version, i.label, i.month::text AS month, i.due_date::text AS due_date, i.planned_cents::text AS planned_cents, i.category_id,
              i.purpose, i.cost_type, i.derived,
              EXISTS (SELECT 1 FROM recurrence_occurrences o WHERE o.household_id=i.household_id AND o.monthly_item_id=i.id) AS in_series
         FROM monthly_items i
        WHERE i.household_id=$1 AND i.id=$2 AND NOT i.archived
        FOR UPDATE OF i`,
      [user.familyId, input.item_id],
    );
    const item = rows[0];
    if (item?.in_series) throw new UserError("Esse item já faz parte de uma recorrência.");
    if (!item || item.purpose !== "expense" || item.cost_type !== "fixed" || item.derived)
      throw new UserError("Esse item não é uma conta fixa avulsa.");
    if (item.version !== input.version) throw new UserError("O item mudou. Abra de novo e tente outra vez.");
    if (item.planned_cents === null || BigInt(item.planned_cents) <= 0n) throw new UserError("A conta precisa ter um valor previsto.");
    const series: RecurrenceRow = {
      id: randomUUID(), household_id: user.familyId, purpose: "expense", label: item.label,
      category_id: item.category_id, account_id: null, expected_cents: item.planned_cents,
      frequency: input.frequency, every: input.every, start_date: input.start_date ?? item.due_date ?? item.month,
      end_date: null, paused: false, date_rule: "exact", planning_offset: 0, match_text: null,
    };
    await validateSeries(tx, user.familyId, series);
    await insertSeries(tx, user.userId, series, null);
    await insertOccurrence(tx, series, series.start_date, expectedDate(toRule(series), series.start_date), input.item_id);
    const created = await syncSeries(tx, user.userId, series, series.start_date, horizonEnd(today));
    await recordAudit(tx, user.familyId, user.userId, "recurrence.convert_legacy", series.id, { item_id: input.item_id, created });
    return { recurrence_id: series.id, created };
  });
}
