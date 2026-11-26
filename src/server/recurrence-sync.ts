import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { createIncomeItem } from "./recurrence-income.ts";
import { budgetMonthOf, competenceOf, loadCardCompetence } from "./card-competence.ts";
import {
  coverage,
  expectedDate,
  occurrencesBetween,
  planningMonth,
  type DateRule,
  type Frequency,
  type RecurrenceRule,
} from "../domain/recurrence.ts";

export type RecurrenceRow = {
  id: string;
  household_id: string;
  purpose: "expense" | "income";
  label: string;
  category_id: string | null;
  account_id: string | null;
  expected_cents: string;
  frequency: Frequency;
  every: number;
  start_date: string;
  end_date: string | null;
  paused: boolean;
  date_rule: DateRule;
  planning_offset: 0 | 1;
  match_text: string | null;
};

export const RECURRENCE_COLUMNS = `id, household_id, purpose, label, category_id, account_id,
  expected_cents::text AS expected_cents, frequency, every, start_date::text AS start_date,
  end_date::text AS end_date, paused, date_rule, planning_offset::int AS planning_offset, match_text`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: isoDate, through: isoDate }).strict();

export function saoPauloToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

// Primeiro dia do mês anterior ao de uma data ou mês ('YYYY-MM[-DD]'): início da janela do sync.
export function previousMonthStart(dateOrMonth: string): string {
  const [y, m] = dateOrMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

// Fim do mês atual + 2: o mesmo horizonte das entradas.
export function horizonEnd(today: string = saoPauloToday()): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10);
}

export function toRule(r: RecurrenceRow): RecurrenceRule {
  return {
    frequency: r.frequency,
    every: r.every,
    startDate: r.start_date,
    endDate: r.end_date,
    dateRule: r.date_rule,
    planningOffset: r.planning_offset,
  };
}

export type ItemDates = (expectedDate: string) => { month: string; due_date: string };
export type DatesResolver = (r: RecurrenceRow) => ItemDates | undefined;

// Despesa em conta de cartão: mês e vencimento vêm da fatura. Sem ciclo, cai no mês da cobrança.
export async function loadDatesResolver(tx: Transaction, familyId: string): Promise<DatesResolver> {
  const cards = new Set(
    (await tx.query<{ id: string }>("SELECT id FROM accounts WHERE household_id=$1 AND kind='card'", [familyId])).rows.map((a) => a.id),
  );
  if (!cards.size) return () => undefined;
  const ctx = await loadCardCompetence(tx, familyId);
  return (r) => {
    const accountId = r.account_id;
    if (r.purpose !== "expense" || accountId === null || !cards.has(accountId)) return undefined;
    return (expected) => {
      const c = competenceOf(ctx, { account_id: accountId, transaction_date: expected });
      const { month } = budgetMonthOf(c, expected);
      return { month: `${month}-01`, due_date: c.month ? (c.dueDate ?? expected) : expected };
    };
  };
}

export function generatedItem(r: RecurrenceRow, occurrenceDate: string, dates?: ItemDates) {
  const rule = toRule(r);
  const expected = expectedDate(rule, occurrenceDate);
  const card = dates?.(expected);
  return {
    expected_date: expected,
    purpose: r.purpose,
    label: r.label,
    planned_cents: r.expected_cents as string | null,
    category_id: r.category_id,
    // Entrada planeja pelo mês da ocorrência teórica (+ offset), não pela data antecipada; despesa pela data prevista.
    month: card?.month ?? `${planningMonth(rule, r.purpose === "income" ? occurrenceDate : expected)}-01`,
    due_date: card?.due_date ?? (r.purpose === "expense" ? expected : null),
  };
}

export async function lockRecurrences(tx: Transaction, familyId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('recurrence-sync:' || $1::text))", [familyId]);
}

export async function loadRecurrence(tx: Transaction, familyId: string, id: string): Promise<RecurrenceRow> {
  const { rows } = await tx.query<RecurrenceRow>(
    `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND id=$2`,
    [familyId, id],
  );
  if (!rows[0]) throw new UserError("Recorrência não encontrada.");
  return rows[0];
}

async function existingDates(tx: Transaction, r: RecurrenceRow, from: string, through: string) {
  const { rows } = await tx.query<{ d: string }>(
    `SELECT occurrence_date::text AS d FROM recurrence_occurrences
      WHERE household_id=$1 AND recurrence_id=$2 AND occurrence_date BETWEEN $3 AND $4`,
    [r.household_id, r.id, from, through],
  );
  return new Set(rows.map((row) => row.d));
}

export async function insertOccurrence(tx: Transaction, r: RecurrenceRow, date: string, expected: string, itemId: string) {
  await tx.query(
    `INSERT INTO recurrence_occurrences(id,household_id,recurrence_id,occurrence_date,expected_date,monthly_item_id)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), r.household_id, r.id, date, expected, itemId],
  );
}

export type GeneratedItem = ReturnType<typeof generatedItem>;
// Cria (ou reaproveita) o item de uma ocorrência que falta. null = pular a data (fica lacuna).
export type ItemCreator = (tx: Transaction, userId: string, r: RecurrenceRow, item: GeneratedItem) => Promise<string | null>;

const insertGeneratedItem: ItemCreator = async (tx, userId, r, item) => {
  const itemId = randomUUID();
  await tx.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,created_by)
     VALUES($1,$2,$3,$4,$5,'BRL',$6,$7,$8,$9)`,
    [itemId, r.household_id, item.month, item.label, item.purpose, item.planned_cents, item.category_id, item.due_date, userId],
  );
  return itemId;
};

// Só insere datas que faltam; nunca atualiza linha existente. A política de criação do item
// depende do purpose: entrada reaproveita o item do mês quando houver um só (recurrence-income).
export async function syncSeries(
  tx: Transaction,
  userId: string,
  r: RecurrenceRow,
  from: string,
  through: string,
  resolver?: DatesResolver,
): Promise<number> {
  const dates = (resolver ?? (await loadDatesResolver(tx, r.household_id)))(r);
  const create = r.purpose === "income" ? createIncomeItem : insertGeneratedItem;
  const expected = occurrencesBetween(toRule(r), from, through);
  const have = await existingDates(tx, r, from, through);
  let created = 0;
  for (const date of expected.filter((d) => !have.has(d))) {
    const item = generatedItem(r, date, dates);
    const itemId = await create(tx, userId, r, item);
    if (itemId === null) continue;
    await insertOccurrence(tx, r, date, item.expected_date, itemId);
    created++;
  }
  return created;
}

export async function syncRecurrences(db: Database, user: Identity, raw: unknown): Promise<{ created: number }> {
  canWrite(user);
  const input = range.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const { rows } = await tx.query<RecurrenceRow>(
      `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND NOT paused ORDER BY created_at, id`,
      [user.familyId],
    );
    const resolver = await loadDatesResolver(tx, user.familyId);
    let created = 0;
    for (const r of rows) created += await syncSeries(tx, user.userId, r, input.from, input.through, resolver);
    if (created > 0) await recordAudit(tx, user.familyId, user.userId, "recurrence.sync", user.familyId, { ...input, created });
    return { created };
  });
}

export async function readCoverage(
  tx: Transaction,
  familyId: string,
  month: string,
): Promise<"complete" | "pending"> {
  const [y, m] = month.split("-").map(Number);
  const from = previousMonthStart(month);
  const through = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { rows } = await tx.query<RecurrenceRow>(
    `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND NOT paused`,
    [familyId],
  );
  const resolver = await loadDatesResolver(tx, familyId);
  for (const r of rows) {
    const planned = occurrencesBetween(toRule(r), from, through).filter((d) => generatedItem(r, d, resolver(r)).month === `${month}-01`);
    const have = await existingDates(tx, r, from, through);
    if (coverage(planned, have) === "pending") return "pending";
  }
  return "complete";
}
