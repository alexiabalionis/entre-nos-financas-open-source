import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { incomeDate } from "../src/domain/bank-analysis.ts";
import { asUser, openDatabase } from "../src/server/db.ts";
import { runIncomeMigration } from "../src/server/income-migration.ts";
import { verifyIncome } from "../src/server/income-migration-verify.ts";
import { UserError } from "../src/server/imports.ts";
import { saveItem } from "../src/server/routine.ts";
import { moveIncomeToLegacy } from "./income-seed.ts";
import {
  addCredit,
  analyze,
  incomeItem,
  makeWorld,
  saveRule,
  type World,
} from "./income-baseline-helpers.ts";

// Etapa 3b: migração das entradas para o núcleo (spec 7.2 e 7.3). Só banco em memória.

let db: PGlite;
before(async () => {
  db = await openDatabase();
});
after(async () => {
  await db.close();
});

async function count(w: World, table: string): Promise<number> {
  const { rows } = await w.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE household_id=$1`,
    [w.u.familyId],
  );
  return rows[0].n;
}

async function fullWorld(tag: string): Promise<World> {
  const w = await makeWorld(db, tag);
  await saveRule(w, { label: "Salário A", match_text: "EMPREGADOR A", budget_offset: 1 });
  await saveRule(w, { label: "Salário B", match_text: "EMPREGADOR B", budget_offset: 0, day: 7 });
  await saveRule(w, {
    label: "Trabalho variável",
    match_text: "EMPRESA TRABALHO",
    receipt_mode: "business_window",
    budget_offset: 0,
    expected_cents: "650000",
  });
  await saveRule(w, { label: "Pausada", match_text: "EMPREGADOR P" });
  await addCredit(w, { date: incomeDate("2026-01"), cents: 800000, description: "EMPREGADOR A" }); // detected
  await addCredit(w, { date: "2026-02-20", cents: 800000, description: "EMPREGADOR A" }); // review
  await analyze(w);
  await moveIncomeToLegacy(w.db, w.u.familyId);
  await w.db.query("UPDATE income_rules SET enabled=false WHERE household_id=$1 AND label='Pausada'", [
    w.u.familyId,
  ]);
  return w;
}

test("migra ativa, pausada, business_window, offset 0 e 1, detected/review/planned com os mesmos ids", async () => {
  const w = await fullWorld("cenarios");
  const rules = await count(w, "income_rules");
  const occurrences = await count(w, "income_occurrences");
  assert.ok(rules === 4 && occurrences > 8);
  const report = await runIncomeMigration(w.db, w.u, { apply: true });
  assert.equal(report.ok, true, JSON.stringify(report.divergences));
  assert.equal(report.applied, true);
  assert.deepEqual(report.migrated, { rules, occurrences });
  const states = (
    await w.db.query<{ match_state: string }>(
      "SELECT DISTINCT match_state FROM recurrence_occurrences WHERE household_id=$1",
      [w.u.familyId],
    )
  ).rows.map((r) => r.match_state);
  assert.deepEqual(states.sort(), ["detected", "planned", "review"]);
  const ids = await w.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM income_occurrences o JOIN recurrence_occurrences n ON n.id=o.id WHERE o.household_id=$1`,
    [w.u.familyId],
  );
  assert.equal(ids.rows[0].n, occurrences);
  const paused = await w.db.query<{ paused: boolean; end_date: string | null }>(
    "SELECT paused, end_date::text FROM recurrences WHERE household_id=$1 AND label='Pausada'",
    [w.u.familyId],
  );
  assert.deepEqual(paused.rows[0], { paused: true, end_date: null });
  const check = await asUser(w.db, w.u.userId, (tx) => verifyIncome(tx, w.u.familyId));
  assert.deepEqual(check, { ok: true, divergences: [] });
  assert.equal(await audits(w), 1);
});

test("rodar duas vezes é idempotente", async () => {
  const w = await fullWorld("idempotente");
  await runIncomeMigration(w.db, w.u, { apply: true });
  const before = [await count(w, "recurrences"), await count(w, "recurrence_occurrences")];
  const again = await runIncomeMigration(w.db, w.u, { apply: true });
  assert.equal(again.ok, true);
  assert.deepEqual(again.migrated, { rules: 0, occurrences: 0 });
  assert.deepEqual([await count(w, "recurrences"), await count(w, "recurrence_occurrences")], before);
});

test("destino adulterado (mesmo id, valor diferente) bloqueia e não grava nada", async () => {
  const w = await makeWorld(db, "adulterado");
  await saveRule(w);
  await moveIncomeToLegacy(w.db, w.u.familyId);
  const rule = (
    await w.db.query<{ id: string; created_by: string; created_at: string }>(
      "SELECT id,created_by,created_at::text FROM income_rules WHERE household_id=$1",
      [w.u.familyId],
    )
  ).rows[0];
  await w.db.query(
    `INSERT INTO recurrences(id,household_id,purpose,label,account_id,expected_cents,frequency,every,start_date,paused,date_rule,planning_offset,match_text,created_by,created_at)
     VALUES($1,$2,'income','Salário',$3,1,'month',1,'2026-01-25',false,'weekend_to_friday',1,'EMPREGADOR TESTE',$4,$5)`,
    [rule.id, w.u.familyId, w.account, rule.created_by, rule.created_at],
  );
  const report = await runIncomeMigration(w.db, w.u, { apply: true });
  assert.equal(report.ok, false);
  assert.equal(report.applied, false);
  assert.ok(
    report.divergences.some(
      (d) => d.kind === "rule_field_mismatch" && d.field === "expected_cents" && d.old === "800000" && d.new === "1",
    ),
  );
  assert.equal(await count(w, "recurrences"), 1);
  assert.equal(await count(w, "recurrence_occurrences"), 0);
  assert.equal(await audits(w), 0);
});

test("dry-run migra e verifica, mas sempre desfaz", async () => {
  const w = await fullWorld("dryrun");
  const report = await runIncomeMigration(w.db, w.u, { apply: false });
  assert.equal(report.ok, true);
  assert.equal(report.applied, false);
  assert.ok(report.migrated.rules === 4);
  assert.equal(await count(w, "recurrences"), 0);
  assert.equal(await count(w, "recurrence_occurrences"), 0);
});

test("quem não é owner é recusado", async () => {
  const w = await makeWorld(db, "papel");
  await assert.rejects(
    runIncomeMigration(w.db, { ...w.u, role: "editor" }, { apply: true }),
    UserError,
  );
});

test("datas e meses fora do esperado viram divergência, sem ajuste automático", async () => {
  const w = await makeWorld(db, "revisao");
  await saveRule(w);
  await moveIncomeToLegacy(w.db, w.u.familyId);
  await w.db.query(
    "UPDATE income_occurrences SET expected_date=expected_date+1 WHERE household_id=$1 AND pay_month='2026-03-01'",
    [w.u.familyId],
  );
  await w.db.query(
    "UPDATE income_occurrences SET budget_month='2026-12-01' WHERE household_id=$1 AND pay_month='2026-04-01'",
    [w.u.familyId],
  );
  const report = await runIncomeMigration(w.db, w.u, { apply: true });
  assert.equal(report.ok, false);
  const kinds = report.divergences.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ["expected_date_review", "item_month_mismatch"]);
  assert.equal(await count(w, "recurrence_occurrences"), 0);
});

test("findIncomeDuplicates acha o cenário D2 do baseline e não altera nada", async () => {
  const w = await makeWorld(db, "d2");
  await saveRule(w);
  const item = await incomeItem(w, "2026-04", "Salário");
  await moveIncomeToLegacy(w.db, w.u.familyId);
  const clean = await runIncomeMigration(w.db, w.u, { apply: false });
  assert.deepEqual(clean.duplicates, []);
  await saveItem(w.db, w.u, {
    id: item.id,
    version: item.version,
    month: "2026-04",
    label: "Salário renomeado",
    purpose: "income",
    currency: "BRL",
    amount: "8000,00",
    due_date: null,
    notes: item.notes,
  });
  // Como o modelo antigo fazia: a próxima leitura criava outro item com o nome da regra.
  await w.db.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,created_by) VALUES(gen_random_uuid(),$1,'2026-04-01','Salário','income','BRL',800000,$2)`,
    [w.u.familyId, w.u.userId],
  );
  const report = await runIncomeMigration(w.db, w.u, { apply: false });
  assert.equal(report.duplicates.length, 1);
  const dup = report.duplicates[0];
  assert.equal(dup.rule_label, "Salário");
  assert.equal(dup.month, "2026-04-01");
  assert.equal(dup.occurrence_item_id, item.id);
  assert.notEqual(dup.item_id, item.id);
});

async function audits(w: World): Promise<number> {
  const { rows } = await w.db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_events WHERE household_id=$1 AND action='recurrence.migrate_income'",
    [w.u.familyId],
  );
  return rows[0].n;
}
