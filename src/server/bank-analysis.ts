import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import {
  analyzeObservations,
  followingMonth,
  type Observation,
  type Evidence,
} from "../domain/bank-analysis.ts";
import { resolveCategory } from "./assisted.ts";
import { normalize } from "../domain/finance.ts";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { saveIncomeRuleTx } from "./income-rules.ts";
import { detectIncomeMatches, syncIncomeSeries } from "./income-sync.ts";
import { effectiveProviderStatus, settledToday } from "./bank-settled.ts";
export async function analyzeBanksTx(tx: Transaction, u: Identity) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "bank-analysis:" + u.familyId,
  ]);
  const today = settledToday();
  const bank = (
    await tx.query<Observation>(
      `SELECT b.*,transaction_date::text,amount_cents::text,a.kind AS account_kind,c.user_id AS owner_id FROM bank_transactions b JOIN accounts a ON a.id=b.local_account_id JOIN bank_accounts ba ON ba.id=b.bank_account_id JOIN bank_connections c ON c.id=ba.connection_id WHERE b.household_id=$1`,
      [u.familyId],
    )
  ).rows.map((r) => ({
    ...r,
    provider_status: effectiveProviderStatus(r.provider_status, r.transaction_date, today),
  }));
  const legs = (
    await tx.query<Evidence>(
      `SELECT e.id,e.description,e.transaction_date::text,l.account_id,l.currency,l.amount_cents::text,e.kind,
        (SELECT array_agg(DISTINCT bt.bank_account_id::text) FROM bank_transactions bt WHERE bt.household_id=e.household_id AND bt.event_id=e.id) AS bank_account_ids
       FROM economic_events e JOIN ledger_entries l ON l.event_id=e.id WHERE e.household_id=$1`,
      [u.familyId],
    )
  ).rows;
  const staged = (
    await tx.query<Evidence>(
      `SELECT s.id,s.description,s.transaction_date::text,s.amount_cents::text,s.currency,b.account_id,f.filename,es.event_id FROM staged_transactions s JOIN import_batches b ON b.id=s.batch_id JOIN source_files f ON f.id=b.source_id LEFT JOIN event_sources es ON es.staged_id=s.id WHERE s.household_id=$1`,
      [u.familyId],
    )
  ).rows;
  const incomeRules = (
    await tx.query<{
      account_id: string;
      match_text: string;
      label: string;
      budget_offset: number;
    }>(
      "SELECT DISTINCT account_id,match_text,label,planning_offset::int AS budget_offset FROM recurrences WHERE household_id=$1 AND purpose='income' AND NOT paused AND account_id IS NOT NULL AND match_text IS NOT NULL",
      [u.familyId],
    )
  ).rows;
  const analysis = analyzeObservations(bank, legs, staged, incomeRules);
  const planning = (
    await tx.query<{
      label: string;
      month: string;
      sheet: string;
      cell: string;
      planned_cents: string | null;
      actual_cents: string | null;
      filename: string;
    }>(
      `SELECT p.label,p.month::text,p.sheet,p.cell,p.planned_cents::text,p.actual_cents::text,s.filename FROM planning_lines p JOIN planning_sources s ON s.id=p.source_id WHERE p.household_id=$1`,
      [u.familyId],
    )
  ).rows;
  const merchants = (
    await tx.query<{ match_text: string; category_name: string; note: string }>(
      "SELECT match_text,category_name,note FROM merchant_rules WHERE household_id=$1",
      [u.familyId],
    )
  ).rows;
  for (const row of bank) {
    const a = analysis.get(row.id)!;
    const text = normalize(row.description);
    // Precedência regra->regex->fallback centralizada em resolveCategory (DRY);
    // `known` serve só para anexar a nota da regra à sugestão, quando existir.
    const resolved = resolveCategory(merchants, row.description);
    const known = merchants.find((m) => text.includes(normalize(m.match_text)));
    if (
      !["transfer", "card", "investment", "income"].includes(a.group) &&
      BigInt(row.amount_cents) < 0n &&
      resolved.strong
    ) {
      a.category_suggestion =
        known && known.note ? resolved.name + " · " + known.note : resolved.name;
    }
    const matchedIncome = incomeRules.find(
      (rule) =>
        rule.account_id === row.local_account_id &&
        text.includes(normalize(rule.match_text)),
    );
    const target =
      matchedIncome?.budget_offset === 1
        ? followingMonth(row.transaction_date.slice(0, 7))
        : row.transaction_date.slice(0, 7);
    const matches = planning.filter(
      (p) =>
        p.month.startsWith(target) &&
        normalize(p.label)
          .split(/\W+/)
          .some((w) => w.length >= 5 && text.includes(w)),
    );
    a.planning = matches
      .slice(0, 4)
      .map(
        (p) =>
          `${p.filename} · ${p.sheet}!${p.cell} · ${p.label}. Referência planejada, não comprova pagamento.`,
      );
  }
  await tx.query(
    `UPDATE bank_transactions b SET analysis=x.analysis,analyzed_at=now() FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,analysis jsonb) WHERE b.id=x.id AND b.household_id=$2 AND b.analysis IS DISTINCT FROM x.analysis`,
    [
      JSON.stringify([...analysis].map(([id, a]) => ({ id, analysis: a }))),
      u.familyId,
    ],
  );
  await syncIncomeSeries(tx, u.userId, u.familyId);
  await detectIncomeMatches(tx, u.familyId, bank);
  const counts: Record<string, number> = {};
  for (const r of bank.filter((b) => b.status === "pending")) {
    const group = analysis.get(r.id)!.group;
    counts[group] = (counts[group] || 0) + 1;
  }
  return {
    counts,
    total: bank.filter((b) => b.status === "pending").length,
    financial_events_created: 0,
  };
}
export async function analyzeBanks(db: Database, u: Identity) {
  if (!["owner", "editor"].includes(u.role))
    throw new UserError("Seu acesso é somente para leitura.");
  return asUser(db, u.userId, async (tx) => {
    const result = await analyzeBanksTx(tx, u);
    await recordAudit(
      tx,
      u.familyId,
      u.userId,
      "bank.analysis",
      u.familyId,
      result,
    );
    return result;
  });
}
export async function configureIncome(db: Database, u: Identity, raw: unknown) {
  if (!["owner", "editor"].includes(u.role))
    throw new UserError("Seu acesso é somente para leitura.");
  const v = z
    .object({
      account_id: z.uuid(),
      label: z.string().trim().min(1).max(180),
      match_text: z.string().trim().min(3).max(120),
      day: z.number().int().min(1).max(28),
      expected_cents: z.string().regex(/^[1-9]\d{0,12}$/),
      effective_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      enabled: z.boolean().default(true),
      receipt_mode: z.enum(["fixed", "business_window"]).default("fixed"),
      budget_offset: z.number().int().min(0).max(1).default(1),
    })
    .strict()
    .parse(raw);
  return asUser(db, u.userId, async (tx) => {
    // Serialize family planning writes, including repeated requests from two phones.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "bank-analysis:" + u.familyId,
    ]);
    await saveIncomeRuleTx(tx, u, v);
    const result = await analyzeBanksTx(tx, u);
    await recordAudit(tx, u.familyId, u.userId, "income.rule", u.familyId, {
      day: v.day,
      budget_month_offset: v.budget_offset,
      weekend: "previous_friday",
      financial_events_created: 0,
    });
    return result;
  });
}
