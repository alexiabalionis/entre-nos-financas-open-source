import type { Transaction } from "@electric-sql/pglite";
import type { Observation } from "../domain/bank-analysis.ts";
import { matchIncome } from "../domain/income-detection.ts";
import {
  RECURRENCE_COLUMNS,
  horizonEnd,
  loadDatesResolver,
  lockRecurrences,
  syncSeries,
  type RecurrenceRow,
} from "./recurrence-sync.ts";

// Geração: cada série de entrada não pausada, desde start_date até o fim do mês atual + 2.
// A política de criação do item (reaproveitar/pular) mora em recurrence-income.ts.
export async function syncIncomeSeries(tx: Transaction, userId: string, familyId: string): Promise<void> {
  await lockRecurrences(tx, familyId);
  const { rows } = await tx.query<RecurrenceRow>(
    `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND purpose='income' AND NOT paused ORDER BY created_at, id`,
    [familyId],
  );
  const resolver = await loadDatesResolver(tx, familyId);
  const through = horizonEnd();
  for (const r of rows) await syncSeries(tx, userId, r, r.start_date, through, resolver);
}

type OccurrenceRow = {
  id: string;
  occurrence_date: string;
  expected_date: string;
  account_id: string;
  match_text: string;
  date_rule: string;
  expected_cents: string;
  match_bank_transaction_id: string | null;
  match_state: string;
  match_note: string;
};

// Detecção: atualiza SÓ match_* das ocorrências de entrada. Nunca toca no item.
export async function detectIncomeMatches(tx: Transaction, familyId: string, bank: Observation[]): Promise<void> {
  const { rows } = await tx.query<OccurrenceRow>(
    `SELECT o.id, o.occurrence_date::text AS occurrence_date, o.expected_date::text AS expected_date,
            r.account_id, r.match_text, r.date_rule, r.expected_cents::text AS expected_cents,
            o.match_bank_transaction_id, o.match_state, o.match_note
       FROM recurrence_occurrences o
       JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
      WHERE o.household_id=$1 AND r.purpose='income' AND NOT r.paused AND NOT i.archived
        AND r.account_id IS NOT NULL AND r.match_text IS NOT NULL
      ORDER BY o.occurrence_date, o.id`,
    [familyId],
  );
  for (const o of rows) {
    const m = matchIncome(
      {
        account_id: o.account_id,
        match_text: o.match_text,
        business_window: o.date_rule === "fifth_business_day",
        expected_cents: o.expected_cents,
      },
      o.occurrence_date.slice(0, 7),
      o.expected_date,
      bank,
    );
    if (m.bank_transaction_id === o.match_bank_transaction_id && m.state === o.match_state && m.note === o.match_note) continue;
    await tx.query(
      "UPDATE recurrence_occurrences SET match_bank_transaction_id=$3, match_state=$4, match_note=$5 WHERE household_id=$1 AND id=$2",
      [familyId, o.id, m.bank_transaction_id, m.state, m.note],
    );
  }
}
