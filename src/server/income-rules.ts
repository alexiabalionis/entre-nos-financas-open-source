import type { Transaction } from "@electric-sql/pglite";
import { normalize } from "../domain/finance.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { RECURRENCE_COLUMNS, saoPauloToday, type RecurrenceRow } from "./recurrence-sync.ts";
import { applyFromDateTx, classify, createRecurrenceTx, setPausedTx } from "./recurrence-series.ts";

// Regra de recebimento = as séries de entrada da mesma conta e do mesmo texto. Editar dia ou
// valor encadeia uma série nova (D1); a mais recente é a regra vigente.

export type IncomeRuleInput = {
  account_id: string;
  label: string;
  match_text: string;
  day: number;
  expected_cents: string;
  effective_month: string;
  enabled: boolean;
  receipt_mode: "fixed" | "business_window";
  budget_offset: number;
};

export type IncomeRule = {
  id: string;
  account_id: string;
  label: string;
  match_text: string;
  day: number;
  expected_cents: string;
  effective_month: string;
  enabled: boolean;
  receipt_mode: "fixed" | "business_window";
  budget_offset: number;
  account_name: string;
};

const modeOf = (r: RecurrenceRow): "fixed" | "business_window" =>
  r.date_rule === "fifth_business_day" ? "business_window" : "fixed";

async function loadChain(tx: Transaction, familyId: string, accountId: string, matchText: string) {
  return (
    await tx.query<RecurrenceRow>(
      `SELECT ${RECURRENCE_COLUMNS} FROM recurrences
        WHERE household_id=$1 AND purpose='income' AND account_id=$2 AND match_text=$3
        ORDER BY start_date DESC, created_at DESC, id`,
      [familyId, accountId, matchText],
    )
  ).rows;
}

export async function saveIncomeRuleTx(tx: Transaction, u: Identity, v: IncomeRuleInput): Promise<void> {
  const account = (
    await tx.query(`SELECT id FROM accounts WHERE household_id=$1 AND id=$2 AND kind='checking' AND currency='BRL'`, [
      u.familyId,
      v.account_id,
    ])
  ).rows[0];
  if (!account) throw new UserError("Escolha uma conta corrente em reais da família.");
  const matchText = normalize(v.match_text);
  const dd = String(v.day).padStart(2, "0");
  const chain = await loadChain(tx, u.familyId, v.account_id, matchText);
  const latest = chain[0];
  if (!latest) {
    await createRecurrenceTx(tx, u, {
      purpose: "income",
      label: v.label,
      account_id: v.account_id,
      expected_cents: Number(v.expected_cents),
      frequency: "month",
      every: 1,
      start_date: `${v.effective_month}-${dd}`,
      date_rule: v.receipt_mode === "business_window" ? "fifth_business_day" : "weekend_to_friday",
      planning_offset: v.budget_offset,
      match_text: matchText,
      paused: !v.enabled,
    });
    return;
  }
  if (
    latest.label !== v.label ||
    latest.planning_offset !== v.budget_offset ||
    modeOf(latest) !== v.receipt_mode ||
    chain[chain.length - 1].start_date.slice(0, 7) !== v.effective_month
  )
    throw new UserError(
      "A regra já tem uma destinação de orçamento. Preserve-a e revise o planejamento antes de alterar essa destinação.",
    );
  if (Number(latest.start_date.slice(8, 10)) !== v.day || latest.expected_cents !== v.expected_cents) {
    // D1: vale do 1º dia do mês atual em diante; o passado fica como está e a edição à mão é mantida.
    const from = `${saoPauloToday().slice(0, 7)}-01`;
    const base = latest.start_date >= from ? latest.start_date : from;
    const groups = await classify(tx, latest, from);
    const versions: Record<string, number> = {};
    for (const e of [...groups.replaced, ...groups.edited, ...groups.preserved]) versions[e.monthly_item_id] = e.version;
    const decisions: Record<string, "keep"> = {};
    for (const e of groups.edited) decisions[e.monthly_item_id] = "keep";
    await applyFromDateTx(tx, u, {
      recurrence_id: latest.id,
      from,
      changes: { expected_cents: Number(v.expected_cents), start_date: `${base.slice(0, 7)}-${dd}` },
      decisions,
      versions,
    });
  }
  for (const s of await loadChain(tx, u.familyId, v.account_id, matchText))
    if (s.paused === v.enabled) await setPausedTx(tx, u, { recurrence_id: s.id, paused: !v.enabled });
}

export async function readIncomeRules(tx: Transaction, familyId: string): Promise<IncomeRule[]> {
  return (
    await tx.query<IncomeRule>(
      `SELECT * FROM (
         SELECT DISTINCT ON (r.account_id, r.match_text)
                r.id, r.account_id, r.label, r.match_text, extract(day FROM r.start_date)::int AS day,
                r.expected_cents::text AS expected_cents,
                (SELECT date_trunc('month', min(f.start_date))::date::text FROM recurrences f
                  WHERE f.household_id=r.household_id AND f.purpose='income' AND f.account_id=r.account_id AND f.match_text=r.match_text) AS effective_month,
                NOT r.paused AS enabled,
                CASE r.date_rule WHEN 'fifth_business_day' THEN 'business_window' ELSE 'fixed' END AS receipt_mode,
                r.planning_offset::int AS budget_offset, a.name AS account_name
           FROM recurrences r JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id
          WHERE r.household_id=$1 AND r.purpose='income' AND r.match_text IS NOT NULL
          ORDER BY r.account_id, r.match_text, r.start_date DESC, r.created_at DESC, r.id
       ) x ORDER BY x.label`,
      [familyId],
    )
  ).rows;
}
