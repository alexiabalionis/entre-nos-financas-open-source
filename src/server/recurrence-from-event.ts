import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { merchantKey } from "./assisted.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { occurrencesBetween, startBackTo } from "../domain/recurrence.ts";
import { populateSeries } from "./recurrence-backfill.ts";
import { insertSeries, validateSeries } from "./recurrence-series.ts";
import {
  generatedItem,
  horizonEnd,
  insertOccurrence,
  loadDatesResolver,
  lockRecurrences,
  previousMonthStart,
  saoPauloToday,
  syncSeries,
  toRule,
  type RecurrenceRow,
} from "./recurrence-sync.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const inputSchema = z
  .object({
    event_id: z.uuid(),
    frequency: z.enum(["day", "week", "month", "year"]),
    every: z.number().int().min(1).max(366).optional(),
    start_date: isoDate.optional(),
    expected_cents: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(180).optional(),
    category_id: z.uuid().optional(),
    confirm: z.boolean().optional(),
    today: isoDate.optional(),
    since_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    end_date: isoDate.optional(),
  })
  .strict();

export class AlreadyInSeriesError extends UserError {
  readonly recurrenceId: string;
  constructor(recurrenceId: string) {
    super("Essa transação já faz parte de uma conta fixa.");
    this.recurrenceId = recurrenceId;
  }
}

type EventRow = {
  id: string;
  kind: string;
  description: string;
  currency: string;
  transaction_date: string;
  account_id: string;
  category_id: string | null;
  cents: string;
};
type Linked = { id: string; recurrence_id: string | null };
export type CreateFromEventResult =
  | { conflict: { recurrence_id: string; label: string }[] }
  | { recurrence_id: string; created: number; source_linked: boolean };

async function loadEvent(tx: Transaction, familyId: string, eventId: string): Promise<EventRow> {
  const { rows } = await tx.query<EventRow>(
    `SELECT id, kind, description, currency, transaction_date::text AS transaction_date, account_id, category_id, abs(amount_cents)::text AS cents
       FROM economic_events WHERE household_id=$1 AND id=$2`,
    [familyId, eventId],
  );
  if (!rows[0]) throw new UserError("Transação não encontrada. Se ela ainda está pendente, aprove antes de criar a conta fixa.");
  if (rows[0].currency !== "BRL") throw new UserError("Conta fixa só aceita transações em reais.");
  if (!["expense", "fee", "card_purchase"].includes(rows[0].kind)) throw new UserError("Só uma despesa pode virar conta fixa.");
  return rows[0];
}

async function linkedItem(tx: Transaction, familyId: string, eventId: string): Promise<Linked | null> {
  const { rows } = await tx.query<Linked>(
    `SELECT i.id, o.recurrence_id FROM monthly_items i
       LEFT JOIN recurrence_occurrences o ON o.household_id=i.household_id AND o.monthly_item_id=i.id
      WHERE i.household_id=$1 AND i.event_id=$2 AND NOT i.archived`,
    [familyId, eventId],
  );
  return rows[0] ?? null;
}

async function findConflicts(tx: Transaction, r: RecurrenceRow, today: string) {
  const { rows } = await tx.query<{ recurrence_id: string; label: string }>(
    `SELECT id AS recurrence_id, label FROM recurrences
      WHERE household_id=$1 AND purpose='expense' AND (end_date IS NULL OR end_date>=$2)
        AND (($3::text IS NOT NULL AND match_text=$3 AND account_id IS NOT DISTINCT FROM $4::uuid)
          OR (category_id=$5 AND expected_cents BETWEEN $6::bigint*8/10 AND $6::bigint*12/10))
      ORDER BY created_at, id`,
    [r.household_id, today, r.match_text, r.account_id, r.category_id, r.expected_cents],
  );
  return rows;
}

export async function createFromEvent(db: Database, user: Identity, raw: unknown): Promise<CreateFromEventResult> {
  canWrite(user);
  const input = inputSchema.parse(raw);
  const today = input.today ?? saoPauloToday();
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const event = await loadEvent(tx, user.familyId, input.event_id);
    const linked = await linkedItem(tx, user.familyId, event.id);
    if (linked?.recurrence_id) throw new AlreadyInSeriesError(linked.recurrence_id);
    const row: RecurrenceRow = {
      id: randomUUID(), household_id: user.familyId, purpose: "expense", paused: false,
      label: input.label ?? event.description.slice(0, 180),
      category_id: input.category_id ?? event.category_id,
      account_id: event.account_id,
      expected_cents: String(input.expected_cents ?? event.cents),
      frequency: input.frequency, every: input.every ?? 1,
      start_date: input.start_date ?? event.transaction_date,
      end_date: input.end_date ?? null, date_rule: "exact", planning_offset: 0,
      match_text: merchantKey(event.description) || null,
    };
    if (row.start_date < event.transaction_date) {
      throw new UserError("O início da conta fixa não pode ser antes da transação de origem.");
    }
    if (input.since_month) row.start_date = startBackTo(toRule(row), `${input.since_month}-01`);
    await validateSeries(tx, user.familyId, row);
    const conflict = await findConflicts(tx, row, today);
    if (!input.confirm && conflict.length) return { conflict };
    await insertSeries(tx, user.userId, row, null, event.id);
    const resolver = await loadDatesResolver(tx, user.familyId);
    let created = 0;
    let sourceLinked = false;
    if (occurrencesBetween(toRule(row), event.transaction_date, event.transaction_date).length === 1) {
      const item = generatedItem(row, event.transaction_date, resolver(row));
      let itemId = linked?.id;
      if (!itemId) {
        itemId = randomUUID();
        await tx.query(
          `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,status,paid_cents,paid_date,event_id,created_by)
           VALUES($1,$2,$3,$4,'expense','BRL',$5,$6,$7,'done',$8,$9,$10,$11)`,
          [itemId, row.household_id, item.month, row.label, row.expected_cents, row.category_id, item.due_date, event.cents, event.transaction_date, event.id, user.userId],
        );
      }
      await insertOccurrence(tx, row, event.transaction_date, item.expected_date, itemId);
      created++;
      sourceLinked = true;
    }
    if (input.since_month) {
      created += await populateSeries(tx, user.userId, row, today, resolver);
    } else {
      const windowStart = previousMonthStart(today);
      const syncFrom = row.start_date > windowStart ? row.start_date : windowStart;
      created += await syncSeries(tx, user.userId, row, syncFrom, horizonEnd(today), resolver);
    }
    await recordAudit(tx, user.familyId, user.userId, "recurrence.from_event", row.id, {
      event_id: event.id,
      created,
      confirm: input.confirm ?? false,
      conflicts_ignored: conflict.length,
    });
    return { recurrence_id: row.id, created, source_linked: sourceLinked };
  });
}
