import { randomUUID } from "node:crypto";

type Run = (sql: string, params?: unknown[]) => Promise<unknown>;

// Semeia direto no núcleo (recurrences + recurrence_occurrences) uma série mensal de entrada,
// no lugar das antigas tabelas de regra de recebimento.
export async function seedIncomeSeries(
  run: Run,
  o: {
    familyId: string;
    userId: string;
    accountId: string;
    label?: string;
    matchText?: string;
    day: number;
    cents: number;
  },
): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO recurrences(id,household_id,purpose,label,account_id,expected_cents,frequency,every,start_date,date_rule,planning_offset,match_text,created_by)
     VALUES($1,$2,'income',$3,$4,$5,'month',1,$6,'weekend_to_friday',0,$7,$8)`,
    [
      id,
      o.familyId,
      o.label ?? "Salário",
      o.accountId,
      o.cents,
      `2026-01-${String(o.day).padStart(2, "0")}`,
      o.matchText ?? "SALARIO",
      o.userId,
    ],
  );
  return id;
}

export async function seedIncomeOccurrence(
  run: Run,
  o: {
    familyId: string;
    recurrenceId: string;
    itemId: string;
    occurrenceDate: string;
    expectedDate: string;
    state: "planned" | "detected" | "review";
  },
): Promise<void> {
  await run(
    `INSERT INTO recurrence_occurrences(id,household_id,recurrence_id,occurrence_date,expected_date,monthly_item_id,match_state)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), o.familyId, o.recurrenceId, o.occurrenceDate, o.expectedDate, o.itemId, o.state],
  );
}

// Só para tests-js/income-migration.test.ts: o app não grava mais nas tabelas antigas, então o
// cenário "legado" é montado copiando o núcleo para elas e esvaziando as séries de entrada.
export async function moveIncomeToLegacy(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  familyId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO income_rules(id,household_id,account_id,label,match_text,day,expected_cents,effective_month,enabled,created_by,created_at,receipt_mode,budget_offset)
     SELECT id,household_id,account_id,label,match_text,extract(day FROM start_date)::int,expected_cents,date_trunc('month',start_date)::date,NOT paused,created_by,created_at,
            CASE date_rule WHEN 'fifth_business_day' THEN 'business_window' ELSE 'fixed' END,planning_offset
       FROM recurrences WHERE household_id=$1 AND purpose='income'`,
    [familyId],
  );
  await db.query(
    `INSERT INTO income_occurrences(id,household_id,rule_id,pay_month,expected_date,budget_month,monthly_item_id,bank_transaction_id,state,note)
     SELECT o.id,o.household_id,o.recurrence_id,date_trunc('month',o.occurrence_date)::date,o.expected_date,i.month,o.monthly_item_id,o.match_bank_transaction_id,o.match_state,o.match_note
       FROM recurrence_occurrences o JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
      WHERE o.household_id=$1`,
    [familyId],
  );
  await db.query("DELETE FROM recurrence_occurrences WHERE household_id=$1", [familyId]);
  await db.query("DELETE FROM recurrences WHERE household_id=$1 AND purpose='income'", [familyId]);
}
