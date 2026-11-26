import type { Transaction } from "@electric-sql/pglite";
import { expectedDate, type DateRule } from "../domain/recurrence.ts";

export type Divergence = {
  kind: string;
  id: string;
  field?: string;
  old?: string | null;
  new?: string | null;
};

export type VerifyReport = { ok: boolean; divergences: Divergence[] };

type Row = Record<string, string | null>;

const RULE_FIELDS = [
  "household_id", "purpose", "label", "category_id", "account_id", "expected_cents", "frequency",
  "every", "start_date", "end_date", "paused", "date_rule", "planning_offset", "match_text",
  "created_by", "created_at",
];
const OCC_FIELDS = [
  "household_id", "recurrence_id", "occurrence_date", "expected_date", "monthly_item_id",
  "match_bank_transaction_id", "match_state", "match_note",
];

// Lado antigo já no formato do destino (mapeamento da 7.2), tudo como texto.
const OLD_RULE = `SELECT id::text AS id, household_id::text, 'income' AS purpose, label, NULL::text AS category_id,
  account_id::text, expected_cents::text, 'month' AS frequency, '1' AS every,
  (effective_month + (day-1))::text AS start_date, NULL::text AS end_date, (NOT enabled)::text AS paused,
  CASE receipt_mode WHEN 'business_window' THEN 'fifth_business_day' ELSE 'weekend_to_friday' END AS date_rule,
  budget_offset::text AS planning_offset, match_text, created_by::text, created_at::text
  FROM income_rules WHERE household_id=$1`;
const NEW_RULE = `SELECT id::text AS id, household_id::text, purpose, label, category_id::text, account_id::text,
  expected_cents::text, frequency, every::text, start_date::text, end_date::text, paused::text, date_rule,
  planning_offset::text, match_text, created_by::text, created_at::text
  FROM recurrences WHERE household_id=$1 AND purpose='income'`;
const OLD_OCC = `SELECT o.id::text AS id, o.household_id::text, o.rule_id::text AS recurrence_id,
  (date_trunc('month',o.pay_month)::date + (r.day-1))::text AS occurrence_date,
  o.expected_date::text, o.monthly_item_id::text, o.bank_transaction_id::text AS match_bank_transaction_id,
  o.state AS match_state, o.note AS match_note, o.pay_month::text AS pay_month, o.budget_month::text AS budget_month
  FROM income_occurrences o JOIN income_rules r ON r.household_id=o.household_id AND r.id=o.rule_id WHERE o.household_id=$1`;
const NEW_OCC = `SELECT o.id::text AS id, o.household_id::text, o.recurrence_id::text, o.occurrence_date::text,
  o.expected_date::text, o.monthly_item_id::text, o.match_bank_transaction_id::text, o.match_state, o.match_note,
  r.date_rule AS date_rule, m.month::text AS item_month
  FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
  LEFT JOIN monthly_items m ON m.household_id=o.household_id AND m.id=o.monthly_item_id
  WHERE o.household_id=$1 AND r.purpose='income'`;

async function load(tx: Transaction, sql: string, familyId: string): Promise<Map<string, Row>> {
  const { rows } = await tx.query<Row>(sql, [familyId]);
  return new Map(rows.map((r) => [r.id as string, r]));
}

function compare(entity: string, fields: string[], olds: Map<string, Row>, news: Map<string, Row>): Divergence[] {
  const out: Divergence[] = [];
  for (const [id, o] of olds) {
    const n = news.get(id);
    if (!n) {
      out.push({ kind: `${entity}_missing_destination`, id });
      continue;
    }
    for (const field of fields)
      if ((o[field] ?? null) !== (n[field] ?? null))
        out.push({ kind: `${entity}_field_mismatch`, id, field, old: o[field] ?? null, new: n[field] ?? null });
  }
  for (const id of news.keys()) if (!olds.has(id)) out.push({ kind: `${entity}_missing_source`, id });
  return out;
}

function occurrenceChecks(olds: Map<string, Row>, news: Map<string, Row>): Divergence[] {
  const out: Divergence[] = [];
  for (const [id, n] of news) {
    const o = olds.get(id);
    const occ = n.occurrence_date as string;
    if (o && o.pay_month?.slice(0, 7) !== occ.slice(0, 7))
      out.push({ kind: "pay_month_mismatch", id, old: o.pay_month, new: occ });
    if (o && n.item_month !== o.budget_month)
      out.push({ kind: "item_month_mismatch", id, old: o.budget_month, new: n.item_month });
    const rule = { frequency: "month", every: 1, startDate: occ, endDate: null, dateRule: n.date_rule as DateRule, planningOffset: 0 } as const;
    const expected = expectedDate(rule, occ);
    if (n.expected_date !== expected)
      out.push({ kind: "expected_date_review", id, field: "expected_date", old: n.expected_date, new: expected });
  }
  return out;
}

export async function verifyIncome(tx: Transaction, familyId: string): Promise<VerifyReport> {
  const [oldRules, newRules, oldOccs, newOccs] = await Promise.all([
    load(tx, OLD_RULE, familyId),
    load(tx, NEW_RULE, familyId),
    load(tx, OLD_OCC, familyId),
    load(tx, NEW_OCC, familyId),
  ]);
  const divergences = [
    ...compare("rule", RULE_FIELDS, oldRules, newRules),
    ...compare("occurrence", OCC_FIELDS, oldOccs, newOccs),
    ...occurrenceChecks(oldOccs, newOccs),
  ];
  if (oldRules.size !== newRules.size)
    divergences.push({ kind: "count_mismatch", id: "rules", old: String(oldRules.size), new: String(newRules.size) });
  if (oldOccs.size !== newOccs.size)
    divergences.push({ kind: "count_mismatch", id: "occurrences", old: String(oldOccs.size), new: String(newOccs.size) });
  return { ok: divergences.length === 0, divergences };
}
