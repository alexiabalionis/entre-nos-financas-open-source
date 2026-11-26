import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { lockRecurrences } from "./recurrence-sync.ts";
import { verifyIncome, type Divergence } from "./income-migration-verify.ts";

export type { Divergence } from "./income-migration-verify.ts";

export type IncomeDuplicate = {
  rule_id: string;
  rule_label: string;
  month: string;
  item_id: string;
  occurrence_id: string;
  occurrence_item_id: string;
};

export type IncomeMigrationReport = {
  ok: boolean;
  applied: boolean;
  divergences: Divergence[];
  duplicates: IncomeDuplicate[];
  migrated: { rules: number; occurrences: number };
};

// Copia regras e ocorrências com os mesmos ids (7.2). ON CONFLICT só permite repetir; quem
// garante o resultado é verifyIncome.
export async function migrateIncome(tx: Transaction, familyId: string): Promise<{ rules: number; occurrences: number }> {
  const rules = await tx.query(
    `INSERT INTO recurrences(id,household_id,purpose,label,category_id,account_id,expected_cents,frequency,every,
       start_date,end_date,paused,date_rule,planning_offset,match_text,created_by,created_at)
     SELECT id,household_id,'income',label,NULL,account_id,expected_cents,'month',1,(effective_month+(day-1)),NULL,
       NOT enabled,CASE receipt_mode WHEN 'business_window' THEN 'fifth_business_day' ELSE 'weekend_to_friday' END,
       budget_offset,match_text,created_by,created_at
     FROM income_rules WHERE household_id=$1
     ON CONFLICT (id) DO NOTHING`,
    [familyId],
  );
  const occurrences = await tx.query(
    `INSERT INTO recurrence_occurrences(id,household_id,recurrence_id,occurrence_date,expected_date,monthly_item_id,
       match_bank_transaction_id,match_state,match_note)
     SELECT o.id,o.household_id,o.rule_id,(date_trunc('month',o.pay_month)::date+(r.day-1)),o.expected_date,
       o.monthly_item_id,o.bank_transaction_id,o.state,o.note
     FROM income_occurrences o JOIN income_rules r ON r.household_id=o.household_id AND r.id=o.rule_id
     WHERE o.household_id=$1
     ON CONFLICT (id) DO NOTHING`,
    [familyId],
  );
  return { rules: rules.affectedRows ?? 0, occurrences: occurrences.affectedRows ?? 0 };
}

// D2 (7.4 item 3): só leitura. Item de entrada com o nome da regra, no mês de planejamento, sem
// ocorrência, enquanto a ocorrência daquele mês aponta para outro item.
export async function findIncomeDuplicates(tx: Transaction, familyId: string): Promise<IncomeDuplicate[]> {
  const { rows } = await tx.query<IncomeDuplicate>(
    `SELECT r.id::text AS rule_id, r.label AS rule_label, i.month::text AS month, i.id::text AS item_id,
            o.id::text AS occurrence_id, o.monthly_item_id::text AS occurrence_item_id
       FROM income_rules r
       JOIN income_occurrences o ON o.household_id=r.household_id AND o.rule_id=r.id
       JOIN monthly_items i ON i.household_id=r.household_id AND i.purpose='income' AND NOT i.archived
        AND i.label=r.label AND i.month=o.budget_month AND i.id<>o.monthly_item_id
      WHERE r.household_id=$1
        AND NOT EXISTS (SELECT 1 FROM income_occurrences x WHERE x.household_id=i.household_id AND x.monthly_item_id=i.id)
      ORDER BY i.month, r.label, i.id`,
    [familyId],
  );
  return rows;
}

// Desfaz a transação inteira e carrega o relatório até o chamador.
class Rollback extends Error {
  report: IncomeMigrationReport;
  constructor(report: IncomeMigrationReport) {
    super("rollback");
    this.report = report;
  }
}

const migrateInput = z.object({ apply: z.boolean() }).strict();

export function parseMigrateIncomeInput(raw: unknown): { apply: boolean } {
  return migrateInput.parse(raw);
}

export async function runIncomeMigration(
  db: Database,
  user: Identity,
  options: { apply: boolean },
): Promise<IncomeMigrationReport> {
  if (user.role !== "owner") throw new UserError("Só quem administra a família pode migrar as entradas.");
  try {
    return await asUser(db, user.userId, async (tx) => {
      await lockRecurrences(tx, user.familyId);
      const migrated = await migrateIncome(tx, user.familyId);
      const { ok, divergences } = await verifyIncome(tx, user.familyId);
      const duplicates = await findIncomeDuplicates(tx, user.familyId);
      const report = { ok, applied: ok && options.apply, divergences, duplicates, migrated };
      if (!report.applied) throw new Rollback(report);
      await recordAudit(tx, user.familyId, user.userId, "recurrence.migrate_income", user.familyId, {
        ...migrated,
        duplicates: duplicates.length,
      });
      return report;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.report;
    throw error;
  }
}
