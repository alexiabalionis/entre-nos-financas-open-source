import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { isManuallyEdited, nthOccurrence, occurrencesBetween, startBackTo } from "../domain/recurrence.ts";
import { populateSeries } from "./recurrence-backfill.ts";
import { brDate } from "../domain/format.ts";
import {
  generatedItem,
  horizonEnd,
  loadDatesResolver,
  loadRecurrence,
  lockRecurrences,
  saoPauloToday,
  syncSeries,
  toRule,
  type RecurrenceRow,
} from "./recurrence-sync.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seriesFields = {
  label: z.string().trim().min(1).max(180),
  category_id: z.uuid().nullable(),
  account_id: z.uuid().nullable(),
  expected_cents: z.number().int().positive(),
  frequency: z.enum(["day", "week", "month", "year"]),
  every: z.number().int().min(1).max(366),
  end_date: isoDate.nullable(),
  date_rule: z.enum(["exact", "weekend_to_friday", "fifth_business_day"]),
  planning_offset: z.union([z.literal(0), z.literal(1)]),
  match_text: z.string().trim().max(120).nullable(),
};
const createSchema = z
  .object({
    ...seriesFields,
    purpose: z.enum(["expense", "income"]),
    start_date: isoDate,
    paused: z.boolean(),
    today: isoDate.optional(),
    // "Desde" (mês): a conta já valia antes do início; recua o início e preenche o passado.
    since_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  })
  .partial({ category_id: true, account_id: true, end_date: true, match_text: true, every: true, date_rule: true, planning_offset: true, today: true, paused: true })
  .strict();
const decisions = z.record(z.string(), z.enum(["replace", "keep"]));
const versions = z.record(z.string(), z.number().int());
const fromSchema = z.object({ recurrence_id: z.uuid(), from: isoDate }).strict();
const applySchema = fromSchema
  .extend({
    changes: z.object({ ...seriesFields, start_date: isoDate }).partial().strict().default({}),
    decisions,
    versions,
    today: isoDate.optional(),
  })
  .strict();
const endSchema = fromSchema.extend({ decisions, versions }).strict();

export type PreviewEntry = { occurrence_id: string; occurrence_date: string; monthly_item_id: string; version: number };
export type Groups = Record<"replaced" | "edited" | "preserved" | "cancelled", PreviewEntry[]>;

async function assertOwned(tx: Transaction, table: "categories" | "accounts", familyId: string, id: string | null) {
  if (id === null) return;
  const { rows } = await tx.query(`SELECT 1 FROM ${table} WHERE household_id=$1 AND id=$2`, [familyId, id]);
  if (!rows.length) throw new UserError(table === "categories" ? "Categoria não encontrada." : "Conta não encontrada.");
}

export async function validateSeries(tx: Transaction, familyId: string, r: Omit<RecurrenceRow, "id" | "household_id" | "paused">) {
  if (r.purpose === "expense" && (r.category_id === null || r.planning_offset !== 0))
    throw new UserError("Despesa precisa de categoria e não adia o mês de planejamento.");
  if (r.end_date !== null && r.end_date < r.start_date) throw new UserError("O fim não pode ser antes do início.");
  try {
    nthOccurrence(toRule({ ...r, id: "", household_id: "", paused: false }), 0);
    if (r.end_date !== null) occurrencesBetween(toRule({ ...r, id: "", household_id: "", paused: false }), r.start_date, r.end_date);
  } catch (error) {
    throw new UserError((error as Error).message);
  }
  await assertOwned(tx, "categories", familyId, r.category_id);
  await assertOwned(tx, "accounts", familyId, r.account_id);
}

export async function insertSeries(tx: Transaction, userId: string, r: RecurrenceRow, replacesId: string | null, sourceEventId: string | null = null) {
  await tx.query(
    `INSERT INTO recurrences(id,household_id,purpose,label,category_id,account_id,expected_cents,frequency,every,start_date,end_date,paused,date_rule,planning_offset,match_text,replaces_id,created_by,source_event_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [r.id, r.household_id, r.purpose, r.label, r.category_id, r.account_id, r.expected_cents, r.frequency, r.every, r.start_date, r.end_date, r.paused, r.date_rule, r.planning_offset, r.match_text, replacesId, userId, sourceEventId],
  );
}

export async function createRecurrence(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => createRecurrenceTx(tx, user, raw));
}

export async function createRecurrenceTx(tx: Transaction, user: Identity, raw: unknown) {
  const { today, since_month, ...input } = createSchema.parse(raw);
  const row: RecurrenceRow = {
    id: randomUUID(), household_id: user.familyId, paused: false,
    category_id: null, account_id: null, end_date: null, match_text: null, every: 1, date_rule: "exact", planning_offset: 0,
    ...input,
    expected_cents: String(input.expected_cents),
  };
  if (since_month) row.start_date = startBackTo(toRule(row), `${since_month}-01`);
  await lockRecurrences(tx, user.familyId);
  await validateSeries(tx, user.familyId, row);
  await insertSeries(tx, user.userId, row, null);
  const created = row.paused
    ? 0
    : since_month
      ? await populateSeries(tx, user.userId, row, today ?? saoPauloToday())
      : await syncSeries(tx, user.userId, row, row.start_date, horizonEnd(today));
  await recordAudit(tx, user.familyId, user.userId, "recurrence.create", row.id, { purpose: row.purpose, created });
  return { recurrence_id: row.id, created };
}

type ItemRow = PreviewEntry & {
  planned_cents: string | null;
  label: string;
  category_id: string | null;
  due_date: string | null;
  month: string;
  archived: boolean;
  realized: boolean;
};

export async function classify(tx: Transaction, r: RecurrenceRow, from: string): Promise<Groups> {
  const dates = (await loadDatesResolver(tx, r.household_id))(r);
  const { rows } = await tx.query<ItemRow>(
    `SELECT o.id AS occurrence_id, o.occurrence_date::text AS occurrence_date, o.monthly_item_id, i.version,
            i.planned_cents::text AS planned_cents, i.label, i.category_id, i.due_date::text AS due_date, i.month::text AS month,
            i.archived, (i.status<>'open' OR i.paid_cents IS NOT NULL OR i.event_id IS NOT NULL) AS realized
       FROM recurrence_occurrences o JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
      WHERE o.household_id=$1 AND o.recurrence_id=$2 AND o.occurrence_date>=$3
      ORDER BY o.occurrence_date`,
    [r.household_id, r.id, from],
  );
  const groups: Groups = { replaced: [], edited: [], preserved: [], cancelled: [] };
  for (const row of rows) {
    const entry = { occurrence_id: row.occurrence_id, occurrence_date: row.occurrence_date, monthly_item_id: row.monthly_item_id, version: row.version };
    if (row.archived) groups.cancelled.push(entry);
    else if (row.realized) groups.preserved.push(entry);
    else if (isManuallyEdited(row, generatedItem(r, row.occurrence_date, dates))) groups.edited.push(entry);
    else groups.replaced.push(entry);
  }
  return groups;
}

/**
 * Até onde uma edição pode voltar: o dia seguinte ao fim da versão anterior
 * (antes dele as contas são dela). Sem versão anterior não há limite: antes do
 * início a série não tem contas. Assim nada já contado ganha uma cópia.
 */
async function editFloor(tx: Transaction, r: RecurrenceRow): Promise<string | null> {
  const { rows } = await tx.query<{ floor: string | null }>(
    `SELECT (max(p.end_date) + 1)::text AS floor FROM recurrences p
      WHERE p.household_id=$1 AND p.id=(SELECT replaces_id FROM recurrences WHERE household_id=$1 AND id=$2)`,
    [r.household_id, r.id],
  );
  return rows[0]?.floor ?? null;
}

async function checkFloor(tx: Transaction, r: RecurrenceRow, from: string) {
  const floor = await editFloor(tx, r);
  if (floor !== null && from < floor)
    throw new UserError(`Dá para voltar até ${brDate(floor)}. Antes disso as contas são da versão anterior desta conta fixa.`);
}

export async function previewFromDate(db: Database, user: Identity, raw: unknown) {
  const input = fromSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const r = await loadRecurrence(tx, user.familyId, input.recurrence_id);
    await checkFloor(tx, r, input.from);
    return { recurrence_id: r.id, from: input.from, groups: await classify(tx, r, input.from) };
  });
}

// Recusa sem decisão para toda editada ou com versão mudada; devolve o que arquivar e o que repassar.
function resolve(groups: Groups, choice: z.infer<typeof decisions>, seen: z.infer<typeof versions>) {
  for (const e of [...groups.replaced, ...groups.edited, ...groups.preserved])
    if (seen[e.monthly_item_id] !== e.version)
      throw new UserError("A previsão mudou desde a prévia. Veja a prévia de novo antes de confirmar.");
  const missing = groups.edited.filter((e) => !choice[e.monthly_item_id]);
  if (missing.length) throw new UserError("Decida o que fazer com cada ocorrência editada à mão.");
  const kept = groups.edited.filter((e) => choice[e.monthly_item_id] === "keep");
  const dropped = groups.edited.filter((e) => choice[e.monthly_item_id] === "replace");
  return { archive: [...groups.replaced, ...dropped], keep: [...groups.preserved, ...kept, ...groups.cancelled] };
}

async function closeSeries(tx: Transaction, user: Identity, r: RecurrenceRow, from: string, archive: PreviewEntry[]) {
  if (r.end_date !== null && from > r.end_date) throw new UserError("A série já termina antes dessa data.");
  const cutoff = from < r.start_date ? r.start_date : from;
  await tx.query("UPDATE recurrences SET end_date=$3::date - 1 WHERE household_id=$1 AND id=$2", [user.familyId, r.id, cutoff]);
  if (archive.length)
    await tx.query(
      `UPDATE monthly_items SET archived=true, version=version+1, updated_at=now()
        WHERE household_id=$1 AND id = ANY($2::uuid[])`,
      [user.familyId, archive.map((e) => e.monthly_item_id)],
    );
}

// Primeira data da série antiga a partir de `from`, para não deslocar a âncora sem querer.
function anchorFrom(old: RecurrenceRow, from: string): string {
  const reach = new Date(Date.parse(`${from}T00:00:00Z`) + (366 * old.every + 31) * 86_400_000).toISOString().slice(0, 10);
  return occurrencesBetween(toRule(old), from, reach)[0] ?? from;
}

export async function applyFromDate(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => applyFromDateTx(tx, user, raw));
}

export async function applyFromDateTx(tx: Transaction, user: Identity, raw: unknown) {
  const input = applySchema.parse(raw);
  await lockRecurrences(tx, user.familyId);
  const old = await loadRecurrence(tx, user.familyId, input.recurrence_id);
  if (input.changes.start_date !== undefined && input.changes.start_date < input.from)
    throw new UserError("O novo início não pode ser antes da data de aplicação.");
  await checkFloor(tx, old, input.from);
  const next: RecurrenceRow = { ...old, ...input.changes, id: randomUUID(), start_date: input.changes.start_date ?? anchorFrom(old, input.from), expected_cents: input.changes.expected_cents === undefined ? old.expected_cents : String(input.changes.expected_cents) };
  await validateSeries(tx, user.familyId, next);
  const { archive, keep } = resolve(await classify(tx, old, input.from), input.decisions, input.versions);
  await closeSeries(tx, user, old, input.from, archive);
  await insertSeries(tx, user.userId, next, old.id);
  const relink = keep.filter((e) => occurrencesBetween(toRule(next), e.occurrence_date, e.occurrence_date).length === 1);
  if (relink.length)
    await tx.query("UPDATE recurrence_occurrences SET recurrence_id=$3 WHERE household_id=$1 AND id = ANY($2::uuid[])", [user.familyId, relink.map((e) => e.occurrence_id), next.id]);
  const created = next.paused ? 0 : await syncSeries(tx, user.userId, next, input.from, horizonEnd(input.today));
  await recordAudit(tx, user.familyId, user.userId, "recurrence.apply", next.id, { replaces: old.id, from: input.from, archived: archive.length, created });
  return { recurrence_id: next.id, created };
}

export async function endRecurrence(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = endSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const r = await loadRecurrence(tx, user.familyId, input.recurrence_id);
    const { archive } = resolve(await classify(tx, r, input.from), input.decisions, input.versions);
    await closeSeries(tx, user, r, input.from, archive);
    await recordAudit(tx, user.familyId, user.userId, "recurrence.end", r.id, { from: input.from, archived: archive.length });
    return { recurrence_id: r.id, archived: archive.length };
  });
}

export async function setPaused(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => setPausedTx(tx, user, raw));
}

export async function setPausedTx(tx: Transaction, user: Identity, raw: unknown) {
  const input = z.object({ recurrence_id: z.uuid(), paused: z.boolean() }).strict().parse(raw);
  await lockRecurrences(tx, user.familyId);
  await loadRecurrence(tx, user.familyId, input.recurrence_id);
  await tx.query("UPDATE recurrences SET paused=$3 WHERE household_id=$1 AND id=$2", [user.familyId, input.recurrence_id, input.paused]);
  await recordAudit(tx, user.familyId, user.userId, input.paused ? "recurrence.pause" : "recurrence.resume", input.recurrence_id);
  return { paused: input.paused };
}
