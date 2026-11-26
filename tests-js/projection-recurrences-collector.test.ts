import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import {
  createFamily,
  issueSession,
  identity,
  type Identity,
} from "../src/server/auth.ts";
import { readProjection, type ProjectionReport } from "../src/server/projection.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";

// 4a: a projeção NÃO prevê mais gasto pelo histórico (detectRecurrences saiu).
// As contas fixas entram só como itens planejados das séries. Banco PGlite em
// memória; "hoje" fixo em 2026-11-09; histórico em ago, set e out de 2026.
const TODAY = "2026-11-09";

let db: PGlite;
let u: Identity;
let bank: string;
let card: string;
const cat: Record<string, string> = {};
let report: ProjectionReport;
let seriesItem: string;

async function run(sql: string, params: unknown[] = []) {
  return asUser(db, u.userId, (tx) => tx.query(sql, params));
}

async function account(name: string, kind: string) {
  const id = randomUUID();
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,$3,'Inst','BRL',$4,0,'2025-12-31',$5)",
    [id, u.familyId, name, kind, u.userId],
  );
  return id;
}

async function category(name: string, essential: boolean, fixed = false) {
  // createFamily já semeia categorias padrão: grava as flags sobre a existente.
  const id = (
    await run(
      `INSERT INTO categories(id,household_id,name,essential,fixed) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(household_id,name) DO UPDATE SET essential=$4,fixed=$5 RETURNING id`,
      [randomUUID(), u.familyId, name, essential, fixed],
    )
  ).rows[0] as { id: string };
  cat[name] = id.id;
}

// Gasto aprovado: valor positivo em centavos, gravado com o sinal do tipo.
async function spend(
  account_id: string,
  kind: "expense" | "card_purchase",
  description: string,
  date: string,
  cents: number,
  categoryName: string,
) {
  const id = randomUUID();
  // Evento + par de lançamentos na MESMA transação (trigger de balanceamento).
  await asUser(db, u.userId, async (tx) => {
    await tx.query(
      `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$6,$7,'BRL',$8,$9)`,
      [
        id,
        u.familyId,
        account_id,
        kind,
        date,
        description,
        -cents,
        cat[categoryName],
        u.userId,
      ],
    );
    await tx.query(
      `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
       VALUES($1,$2,$3,$4,NULL,'BRL',$5,$8),($6,$2,$3,NULL,'expense','BRL',$7,$8)`,
      [randomUUID(), u.familyId, id, account_id, -cents, randomUUID(), cents, date],
    );
  });
}

// O mesmo gasto nos meses ago/set/out (ou só nos meses pedidos).
async function monthly(
  accountId: string,
  kind: "expense" | "card_purchase",
  description: string,
  day: string,
  cents: number,
  categoryName: string,
  months = ["2026-08", "2026-09", "2026-10"],
) {
  for (const m of months)
    await spend(accountId, kind, description, `${m}-${day}`, cents, categoryName);
}

const flow = (key: string) => report.flows.find((f) => f.key === key);

before(async () => {
  db = await openDatabase();
  await createFamily(db, {
    email: "rec-coletor@example.invalid",
    name: "Família recorrência",
    password: "SenhaFicticia!2026",
    familyName: "Família recorrência",
  });
  const row = (
    await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email='rec-coletor@example.invalid'",
    )
  ).rows[0];
  u = (await identity(db, await issueSession(db, row.id)))!;

  bank = await account("Banco rec", "checking");
  await run(
    "UPDATE accounts SET balance_confirmed_cents=900000,balance_confirmed_at=$2 WHERE id=$1",
    [bank, TODAY],
  );
  card = await account("Cartão rec", "card");
  await run(
    `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by)
     VALUES($1,$2,$3,25,5,1,'2026-01-01','2026-01-01',$4)`,
    [randomUUID(), u.familyId, card, u.userId],
  );

  await category("Assinaturas", true);
  await category("Moradia fixa", false, true);
  await category("Saude", true);

  // Antes da 4a, estes históricos virariam fluxos rec: (categoria essencial/fixa
  // ou "sim" na sugestão). Agora nenhum deles prevê nada sozinho.
  await monthly(bank, "expense", "AGUA SABESP", "12", 8000, "Moradia fixa", ["2026-09", "2026-10"]);
  await monthly(bank, "expense", "HBO MAX", "11", 3000, "Assinaturas");
  await run(
    "INSERT INTO recurrence_decisions(household_id,scope,merchant_key,decision,decided_by) VALUES($1,'cash','HBO MAX','confirm',$2)",
    [u.familyId, u.userId],
  );
  await monthly(card, "card_purchase", "SEGURO CELULAR", "10", 4000, "Assinaturas");

  // Conta fixa de verdade: série de despesa, com o histórico do mesmo lojista.
  await monthly(bank, "expense", "ACADEMIA SMART", "20", 15000, "Saude");
  await createRecurrence(db, u, {
    purpose: "expense",
    label: "Academia",
    category_id: cat["Saude"],
    expected_cents: 15000,
    frequency: "month",
    start_date: "2026-11-20",
    match_text: "ACADEMIA SMART",
    today: TODAY,
  });
  const item = (
    await run(
      "SELECT id FROM monthly_items WHERE household_id=$1 AND label='Academia' AND month='2026-11-01'",
      [u.familyId],
    )
  ).rows[0] as { id: string };
  seriesItem = item.id;

  report = await readProjection(db, u, { today: TODAY });
});

after(async () => {
  await db?.close();
});

test("4a: histórico de categoria essencial/fixa ou 'sim' na sugestão não gera previsão nenhuma", () => {
  assert.equal(
    report.flows.some((f) => f.key.startsWith("rec:")),
    false,
  );
  assert.equal(flow("rec:cash:AGUA SABESP:2026-11"), undefined);
  assert.equal(flow("rec:cash:HBO MAX:2026-11"), undefined);
  assert.equal(flow(`rec:${card}:SEGURO CELULAR:2026-11`), undefined);
  assert.equal(
    report.gaps.some((g) => g.key.startsWith("rec:")),
    false,
  );
});

test("4a: a ocorrência da série entra como saída uma única vez, mesmo com o histórico do lojista", () => {
  const matches = report.flows.filter((f) => f.key === `item:${seriesItem}`);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].nom.cents, 15000n);
  assert.equal(matches[0].nom.date, "2026-11-20");
  assert.equal(
    report.flows.some((f) => f.key.includes("ACADEMIA SMART")),
    false,
    "nenhuma previsão paralela pelo texto do extrato",
  );
});
