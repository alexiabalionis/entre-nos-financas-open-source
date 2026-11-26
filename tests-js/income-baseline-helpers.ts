import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { analyzeBanks, configureIncome } from "../src/server/bank-analysis.ts";
import { readRoutine } from "../src/server/routine.ts";

// Harness do baseline das entradas recorrentes (etapa 3a). Tudo que os testes
// leem das entradas recorrentes (núcleo: recurrences + recurrence_occurrences) passa por
// snapshotIncome e pelas leituras públicas.

export type World = {
  db: PGlite;
  u: Identity;
  account: string;
  bankAccount: string;
};

let seq = 0;

export async function makeWorld(db: PGlite, tag: string): Promise<World> {
  const email = `${tag}-${seq++}@example.invalid`;
  const userId = await createFamily(db, {
    name: tag,
    familyName: tag,
    email,
    password: "Ficticia!2026abcd",
  });
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const u = { userId, familyId, name: tag, email, role: "owner" } as Identity;
  const account = randomUUID(),
    connection = randomUUID(),
    bankAccount = randomUUID();
  await db.query(
    `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Conta teste','Banco teste','BRL','checking',$3)`,
    [account, familyId, userId],
  );
  await db.query(
    `INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic-not-a-secret')`,
    [familyId, userId],
  );
  await db.query(
    `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Banco','Titular','2026-01-01')`,
    [connection, familyId, userId, randomUUID()],
  );
  await db.query(
    `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Conta','BRL','BANK',$5)`,
    [bankAccount, familyId, connection, randomUUID(), account],
  );
  return { db, u, account, bankAccount };
}

export type CreditOptions = {
  date: string;
  cents: number;
  description?: string;
  providerStatus?: "POSTED" | "PENDING";
  changed?: boolean;
  missing?: boolean;
};

export async function addCredit(w: World, o: CreditOptions): Promise<string> {
  const id = randomUUID();
  await w.db.query(
    `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,changed,missing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL',$9,'synthetic',$10,$11,$12)`,
    [
      id,
      w.u.familyId,
      w.bankAccount,
      w.account,
      randomUUID(),
      o.date,
      o.description ?? "EMPREGADOR TESTE",
      o.cents,
      o.providerStatus ?? "POSTED",
      randomUUID(),
      o.changed ?? false,
      o.missing ?? false,
    ],
  );
  return id;
}

export type RuleOver = Partial<{
  label: string;
  match_text: string;
  day: number;
  expected_cents: string;
  effective_month: string;
  enabled: boolean;
  receipt_mode: "fixed" | "business_window";
  budget_offset: number;
}>;

// Regra padrão: "Salário", dia 25, R$ 8.000, desde 2026-01, financia o mês seguinte.
export function saveRule(w: World, over: RuleOver = {}) {
  return configureIncome(w.db, w.u, {
    account_id: w.account,
    label: "Salário",
    match_text: "EMPREGADOR TESTE",
    day: 25,
    expected_cents: "800000",
    effective_month: "2026-01",
    ...over,
  });
}

export const analyze = (w: World) => analyzeBanks(w.db, w.u);

export type IncomeRow = {
  occurrence_id: string;
  rule_label: string;
  rule_enabled: boolean;
  pay_month: string; // YYYY-MM
  expected_date: string;
  budget_month: string; // YYYY-MM-DD
  state: string;
  note: string;
  bank_transaction_id: string | null;
  item: {
    id: string;
    month: string;
    label: string;
    planned_cents: string | null;
    status: string;
  } | null;
};

// Único ponto de leitura das ocorrências de entrada (ignora as de item arquivado).
export async function snapshotIncome(
  db: PGlite,
  familyId: string,
): Promise<IncomeRow[]> {
  const rows = (
    await db.query<{
      occurrence_id: string;
      rule_label: string;
      rule_enabled: boolean;
      pay_month: string;
      expected_date: string;
      budget_month: string;
      state: string;
      note: string;
      bank_transaction_id: string | null;
      item_id: string | null;
      item_month: string | null;
      item_label: string | null;
      item_planned: string | null;
      item_status: string | null;
    }>(
      `SELECT o.id AS occurrence_id,r.label AS rule_label,NOT r.paused AS rule_enabled,to_char(o.occurrence_date,'YYYY-MM') AS pay_month,o.expected_date::text,m.month::text AS budget_month,o.match_state AS state,o.match_note AS note,o.match_bank_transaction_id AS bank_transaction_id,m.id AS item_id,m.month::text AS item_month,m.label AS item_label,m.planned_cents::text AS item_planned,m.status AS item_status FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id AND r.purpose='income' JOIN monthly_items m ON m.household_id=o.household_id AND m.id=o.monthly_item_id AND NOT m.archived WHERE o.household_id=$1 ORDER BY r.label,o.occurrence_date`,
      [familyId],
    )
  ).rows;
  return rows.map((r) => ({
    occurrence_id: r.occurrence_id,
    rule_label: r.rule_label,
    rule_enabled: r.rule_enabled,
    pay_month: r.pay_month,
    expected_date: r.expected_date,
    budget_month: r.budget_month,
    state: r.state,
    note: r.note,
    bank_transaction_id: r.bank_transaction_id,
    item:
      r.item_id === null
        ? null
        : {
            id: r.item_id,
            month: r.item_month ?? "",
            label: r.item_label ?? "",
            planned_cents: r.item_planned,
            status: r.item_status ?? "",
          },
  }));
}

export async function snap(w: World): Promise<IncomeRow[]> {
  return snapshotIncome(w.db, w.u.familyId);
}

export function find(
  rows: IncomeRow[],
  payMonth: string,
  ruleLabel = "Salário",
): IncomeRow | undefined {
  return rows.find(
    (r) => r.pay_month === payMonth && r.rule_label === ruleLabel,
  );
}

export function pick(
  rows: IncomeRow[],
  payMonth: string,
  ruleLabel = "Salário",
): IncomeRow {
  const row = find(rows, payMonth, ruleLabel);
  assert.ok(row, `sem ocorrência de ${ruleLabel} em ${payMonth}`);
  return row;
}

// Itens de entrada do mês de planejamento, pela leitura pública do Mês.
export async function incomeItems(w: World, month: string) {
  return (await readRoutine(w.db, w.u, month)).items.filter(
    (i) => i.purpose === "income",
  );
}

export async function incomeItem(w: World, month: string, label = "Salário") {
  const item = (await incomeItems(w, month)).find((i) => i.label === label);
  assert.ok(item, `sem item ${label} em ${month}`);
  return item;
}
