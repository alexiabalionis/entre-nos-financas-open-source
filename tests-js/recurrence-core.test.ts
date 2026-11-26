import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity, type Identity } from "../src/server/auth.ts";
import { UserError } from "../src/server/imports.ts";
import { generatedItem, loadRecurrence, readCoverage, syncRecurrences, syncSeries, type RecurrenceRow } from "../src/server/recurrence-sync.ts";
import {
  applyFromDate,
  createRecurrence,
  endRecurrence,
  previewFromDate,
  setPaused,
} from "../src/server/recurrence-series.ts";
import { cancelOccurrence, changeDueDate, moveCompetence } from "../src/server/recurrence-occurrence.ts";

const TODAY = "2026-11-09";
const WIDE = { from: "2026-01-01", through: "2027-03-31" };

async function setup(db: PGlite, tag: string) {
  const email = `core-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 LIMIT 1", [user.familyId])).rows[0].id;
  const make = async (over: Record<string, unknown> = {}) =>
    createRecurrence(db, user, {
      purpose: "expense", label: "Aluguel", category_id: category, expected_cents: 100000,
      frequency: "month", start_date: "2026-11-05", today: TODAY, ...over,
    });
  return { user, category, make };
}

type Slot = { d: string; item: string; month: string; due: string | null; archived: boolean; version: number; cents: string; rec: string };
const slots = async (db: PGlite, where = "TRUE", params: unknown[] = []) =>
  (
    await db.query<Slot>(
      `SELECT o.occurrence_date::text AS d, i.id AS item, i.month::text AS month, i.due_date::text AS due, i.archived, i.version, i.planned_cents::text AS cents, o.recurrence_id AS rec
         FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id WHERE ${where} ORDER BY o.occurrence_date, i.archived`,
      params,
    )
  ).rows;
const at = async (db: PGlite, date: string) => (await slots(db, "o.occurrence_date=$1", [date]))[0];
const total = async (db: PGlite) => (await db.query<{ n: number }>("SELECT count(*)::int n FROM recurrence_occurrences")).rows[0].n;
const versionsOf = (p: Awaited<ReturnType<typeof previewFromDate>>) =>
  Object.fromEntries([...p.groups.replaced, ...p.groups.edited, ...p.groups.preserved].map((e) => [e.monthly_item_id, e.version]));
const realize = (db: PGlite, item: string) =>
  db.query("UPDATE monthly_items SET status='done', paid_cents=planned_cents, paid_date=due_date, version=version+1 WHERE id=$1", [item]);

test("sync idempotente, concorrente, recria lacuna, respeita cancelada e pausa", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "sync");
    const { recurrence_id: id, created } = await make({ start_date: "2026-09-05" });
    assert.equal(created, 5);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 2 });
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 0 });

    const dec = await at(db, "2026-12-05");
    await db.query("DELETE FROM recurrence_occurrences WHERE monthly_item_id=$1", [dec.item]);
    await db.query("DELETE FROM monthly_items WHERE id=$1", [dec.item]);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 1 });

    await cancelOccurrence(db, user, { item_id: (await at(db, "2027-01-05")).item, version: 1 });
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 0 });
    assert.equal((await at(db, "2027-01-05")).archived, true);

    await setPaused(db, user, { recurrence_id: id, paused: true });
    assert.deepEqual(await syncRecurrences(db, user, { from: "2026-01-01", through: "2027-12-31" }), { created: 0 });
    await setPaused(db, user, { recurrence_id: id, paused: false });
    assert.equal((await syncRecurrences(db, user, { from: "2026-01-01", through: "2027-06-30" })).created, 3);

    const before = await total(db);
    const range = { from: "2026-01-01", through: "2028-06-30" };
    const [a, b] = await Promise.all([syncRecurrences(db, user, range), syncRecurrences(db, user, range)]);
    assert.equal(a.created + b.created, 12);
    assert.equal(await total(db), before + 12);
    assert.equal(await asUser(db, user.userId, (tx) => readCoverage(tx, user.familyId, "2027-02")), "complete");
    assert.equal(await asUser(db, user.userId, (tx) => readCoverage(tx, user.familyId, "2030-02")), "pending");
  } finally {
    await db.close();
  }
});

test("falha no meio desfaz a geração inteira", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "rollback");
    const { recurrence_id: id } = await make();
    const before = await total(db);
    await assert.rejects(
      asUser(db, user.userId, async (tx) => {
        await syncSeries(tx, user.userId, await loadRecurrence(tx, user.familyId, id), "2027-02-01", "2027-06-30");
        throw new Error("falha simulada");
      }),
      /falha simulada/,
    );
    assert.equal(await total(db), before);
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM monthly_items")).rows[0].n, before);
  } finally {
    await db.close();
  }
});

test("semanal gera 4 e 5 itens por mês; renda com offset 1 vai ao mês seguinte sem vencimento", async () => {
  const db = await openDatabase();
  try {
    const { make } = await setup(db, "weekly");
    await make({ frequency: "week" });
    const inMonth = async (m: string) => (await slots(db, "i.month=$1", [m])).length;
    assert.equal(await inMonth("2026-11-01"), 4);
    assert.equal(await inMonth("2026-12-01"), 5);

    await make({ purpose: "income", label: "Salário", category_id: null, date_rule: "weekend_to_friday", planning_offset: 1, start_date: "2026-11-25" });
    const salary = (await slots(db, "i.label='Salário'", []))[0];
    assert.equal(salary.d, "2026-11-25");
    assert.equal(salary.month, "2026-12-01");
    assert.equal(salary.due, null);
    await assert.rejects(make({ label: "Sem categoria", category_id: null }), UserError);
  } finally {
    await db.close();
  }
});

test("prévia classifica os quatro grupos; recusa sem decisão e com version mudada", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "preview");
    const { recurrence_id } = await make({ frequency: "week" });
    await db.query("UPDATE monthly_items SET planned_cents=1, version=version+1 WHERE id=$1", [(await at(db, "2026-11-26")).item]);
    await realize(db, (await at(db, "2026-12-03")).item);
    await cancelOccurrence(db, user, { item_id: (await at(db, "2026-12-10")).item, version: 1 });

    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-19" });
    assert.deepEqual(
      [preview.groups.replaced.length, preview.groups.edited.length, preview.groups.preserved.length, preview.groups.cancelled.length],
      [8, 1, 1, 1],
    );
    assert.equal(preview.groups.edited[0].occurrence_date, "2026-11-26");
    const base = { recurrence_id, from: "2026-11-19", changes: { expected_cents: 20000 }, today: TODAY };
    await assert.rejects(applyFromDate(db, user, { ...base, decisions: {}, versions: versionsOf(preview) }), /Decida/);
    await db.query("UPDATE monthly_items SET version=version+1 WHERE id=$1", [preview.groups.replaced[0].monthly_item_id]);
    const decisions = { [preview.groups.edited[0].monthly_item_id]: "keep" };
    await assert.rejects(applyFromDate(db, user, { ...base, decisions, versions: versionsOf(preview) }), /mudou/);
    assert.equal((await slots(db, "o.recurrence_id=$1", [recurrence_id])).length, 13);
  } finally {
    await db.close();
  }
});

test("manter preserva editada, realizada e cancelada sem duplicar datas", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "keep");
    const { recurrence_id } = await make({ frequency: "week" });
    await db.query("UPDATE monthly_items SET planned_cents=1, version=version+1 WHERE id=$1", [(await at(db, "2026-11-26")).item]);
    await realize(db, (await at(db, "2026-12-03")).item);
    await cancelOccurrence(db, user, { item_id: (await at(db, "2026-12-10")).item, version: 1 });
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-19" });
    const decisions = { [preview.groups.edited[0].monthly_item_id]: "keep" };
    const result = await applyFromDate(db, user, { recurrence_id, from: "2026-11-19", changes: { expected_cents: 20000 }, decisions, versions: versionsOf(preview), today: TODAY });
    assert.equal(result.created, 8);

    const kept = await at(db, "2026-11-26");
    assert.equal(kept.cents, "1");
    assert.equal(kept.archived, false);
    assert.equal(kept.rec, result.recurrence_id);
    const live = await db.query<{ d: string; n: number }>(
      `SELECT o.occurrence_date::text d, (count(*) FILTER (WHERE NOT i.archived))::int n FROM recurrence_occurrences o
         JOIN monthly_items i ON i.id=o.monthly_item_id WHERE o.occurrence_date>='2026-11-19' GROUP BY 1`,
    );
    for (const row of live.rows) assert.equal(row.n, row.d === "2026-12-10" ? 0 : 1, row.d);
    assert.equal((await at(db, "2026-12-17")).cents, "20000");
    for (const d of ["2026-11-05", "2026-11-12"]) assert.deepEqual([(await at(db, d)).cents, (await at(db, d)).archived], ["100000", false]);
    const old = await loadRecurrenceRow(db, recurrence_id);
    assert.equal(old.end_date, "2026-11-18");
  } finally {
    await db.close();
  }
});

const loadRecurrenceRow = async (db: PGlite, id: string) =>
  (await db.query<{ end_date: string }>("SELECT end_date::text end_date FROM recurrences WHERE id=$1", [id])).rows[0];

test("mensal para semanal a partir de D: antes intacto, realizada sem data correspondente fica na antiga", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "freq");
    const { recurrence_id } = await make({ start_date: "2026-09-05" });
    await realize(db, (await at(db, "2026-12-05")).item);
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-10" });
    const result = await applyFromDate(db, user, {
      recurrence_id, from: "2026-11-10", changes: { frequency: "week", start_date: "2026-11-10" }, decisions: {}, versions: versionsOf(preview), today: TODAY,
    });
    for (const d of ["2026-09-05", "2026-10-05", "2026-11-05"]) {
      const s = await at(db, d);
      assert.deepEqual([s.archived, s.rec], [false, recurrence_id]);
    }
    const paid = await at(db, "2026-12-05");
    assert.deepEqual([paid.archived, paid.rec], [false, recurrence_id]);
    assert.equal((await slots(db, "o.recurrence_id=$1 AND o.occurrence_date='2027-01-05'", [recurrence_id]))[0].archived, true);
    const fresh = await slots(db, "o.recurrence_id=$1", [result.recurrence_id]);
    assert.equal(fresh[0].d, "2026-11-10");
    assert.equal(fresh.length, result.created);
    assert.equal((await loadRecurrenceRow(db, recurrence_id)).end_date, "2026-11-09");
  } finally {
    await db.close();
  }
});

test("encerrar preserva realizadas e arquiva o resto", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "end");
    const { recurrence_id } = await make({ start_date: "2026-09-05" });
    await realize(db, (await at(db, "2026-11-05")).item);
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-01" });
    await endRecurrence(db, user, { recurrence_id, from: "2026-11-01", decisions: {}, versions: versionsOf(preview) });
    assert.equal((await at(db, "2026-11-05")).archived, false);
    assert.equal((await at(db, "2026-12-05")).archived, true);
    assert.equal((await at(db, "2026-10-05")).archived, false);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 0 });
  } finally {
    await db.close();
  }
});

test("mover competência mantém id e vínculo; alterar vencimento fora do mês é recusado", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "move");
    await make();
    const dec = await at(db, "2026-12-05");
    const before = await total(db);
    await assert.rejects(moveCompetence(db, user, { item_id: dec.item, version: 1, month: "2027-02", due_date: "2027-03-10" }), UserError);
    await assert.rejects(moveCompetence(db, user, { item_id: dec.item, version: 9, month: "2027-02", due_date: null }), UserError);
    await moveCompetence(db, user, { item_id: dec.item, version: 1, month: "2027-02", due_date: "2027-02-10" });
    const moved = await at(db, "2026-12-05");
    assert.deepEqual([moved.item, moved.month, moved.due, moved.version], [dec.item, "2027-02-01", "2027-02-10", 2]);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 2 });
    assert.equal(await total(db), before + 2);
    assert.equal((await slots(db, "i.month='2026-12-01'")).length, 0);
    const audit = await db.query("SELECT 1 FROM audit_events WHERE action='routine.move' AND entity_id=$1", [dec.item]);
    assert.equal(audit.rows.length, 1);

    const jan = await at(db, "2027-01-05");
    await assert.rejects(changeDueDate(db, user, { item_id: jan.item, version: 1, due_date: "2027-02-05" }), /competência/);
    assert.equal((await at(db, "2027-01-05")).month, "2027-01-01");
    await changeDueDate(db, user, { item_id: jan.item, version: 1, due_date: "2027-01-20" });
    assert.equal((await at(db, "2027-01-05")).due, "2027-01-20");
    await realize(db, (await at(db, "2026-11-05")).item);
    await assert.rejects(changeDueDate(db, user, { item_id: (await at(db, "2026-11-05")).item, version: 2, due_date: "2026-11-20" }), UserError);
  } finally {
    await db.close();
  }
});

test("leitor recebe UserError em toda escrita", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "reader");
    const { recurrence_id } = await make();
    const reader: Identity = { ...user, role: "reader" };
    const item = (await at(db, "2026-12-05")).item;
    const calls = [
      () => createRecurrence(db, reader, {}),
      () => syncRecurrences(db, reader, WIDE),
      () => setPaused(db, reader, { recurrence_id, paused: true }),
      () => cancelOccurrence(db, reader, { item_id: item, version: 1 }),
      () => moveCompetence(db, reader, { item_id: item, version: 1, month: "2027-02", due_date: null }),
      () => changeDueDate(db, reader, { item_id: item, version: 1, due_date: "2026-12-06" }),
      () => applyFromDate(db, reader, {}),
      () => endRecurrence(db, reader, {}),
    ];
    for (const call of calls) await assert.rejects(call(), UserError);
  } finally {
    await db.close();
  }
});

test("aplicar valor a partir da 1ª data troca todas as abertas; sync não gera nada para a antiga", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "first-apply");
    const { recurrence_id } = await make();
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-05" });
    const result = await applyFromDate(db, user, {
      recurrence_id, from: "2026-11-05", changes: { expected_cents: 20000 }, decisions: {}, versions: versionsOf(preview), today: TODAY,
    });
    assert.equal(result.created, 3);
    assert.equal((await loadRecurrenceRow(db, recurrence_id)).end_date, "2026-11-04");
    const old = await slots(db, "o.recurrence_id=$1", [recurrence_id]);
    assert.equal(old.length, 3);
    assert.ok(old.every((s) => s.archived));
    const fresh = await slots(db, "o.recurrence_id=$1", [result.recurrence_id]);
    assert.deepEqual(fresh.map((s) => [s.d, s.cents, s.archived]), [
      ["2026-11-05", "20000", false], ["2026-12-05", "20000", false], ["2027-01-05", "20000", false],
    ]);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 2 });
    assert.equal((await slots(db, "o.recurrence_id=$1", [recurrence_id])).length, 3);
  } finally {
    await db.close();
  }
});

test("encerrar a partir da 1ª data arquiva as abertas, preserva realizadas e o sync não recria", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "first-end");
    const { recurrence_id } = await make();
    await realize(db, (await at(db, "2026-11-05")).item);
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-05" });
    const result = await endRecurrence(db, user, { recurrence_id, from: "2026-11-05", decisions: {}, versions: versionsOf(preview) });
    assert.equal(result.archived, 2);
    assert.equal((await at(db, "2026-11-05")).archived, false);
    assert.equal((await at(db, "2026-12-05")).archived, true);
    assert.equal((await at(db, "2027-01-05")).archived, true);
    assert.deepEqual(await syncRecurrences(db, user, WIDE), { created: 0 });
    assert.equal(await total(db), 3);
  } finally {
    await db.close();
  }
});

test("aplicar a partir de data fora da série mantém a âncora; start_date explícito muda o dia", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "anchor");
    const { recurrence_id } = await make({ start_date: "2026-09-05" });
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-12-10" });
    const result = await applyFromDate(db, user, {
      recurrence_id, from: "2026-12-10", changes: { expected_cents: 20000 }, decisions: {}, versions: versionsOf(preview), today: TODAY,
    });
    const next = await loadRecurrence2(db, result.recurrence_id);
    assert.equal(next.start_date, "2027-01-05");
    const dec = await at(db, "2026-12-05");
    assert.deepEqual([dec.rec, dec.cents, dec.archived], [recurrence_id, "100000", false]);
    assert.equal((await at(db, "2027-01-05")).cents, "20000");

    const second = await make({ label: "Outra", start_date: "2026-09-05" });
    const p = await previewFromDate(db, user, { recurrence_id: second.recurrence_id, from: "2026-12-10" });
    const ok = await applyFromDate(db, user, {
      recurrence_id: second.recurrence_id, from: "2026-12-10", changes: { start_date: "2026-12-20" }, decisions: {}, versions: versionsOf(p), today: TODAY,
    });
    assert.equal((await loadRecurrence2(db, ok.recurrence_id)).start_date, "2026-12-20");
    await assert.rejects(
      applyFromDate(db, user, { recurrence_id: ok.recurrence_id, from: "2027-01-10", changes: { start_date: "2027-01-05" }, decisions: {}, versions: {}, today: TODAY }),
      /novo início/,
    );
  } finally {
    await db.close();
  }
});

const loadRecurrence2 = async (db: PGlite, id: string) =>
  (await db.query<{ start_date: string }>("SELECT start_date::text start_date FROM recurrences WHERE id=$1", [id])).rows[0];

test("cobertura segue o mês de planejamento, não o da data da ocorrência", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "coverage");
    await make({ purpose: "income", label: "Salário", category_id: null, planning_offset: 1, start_date: "2026-11-25" });
    const salary = await at(db, "2026-11-25");
    await db.query("DELETE FROM recurrence_occurrences WHERE monthly_item_id=$1", [salary.item]);
    await db.query("DELETE FROM monthly_items WHERE id=$1", [salary.item]);
    const cover = (month: string) => asUser(db, user.userId, (tx) => readCoverage(tx, user.familyId, month));
    assert.equal(await cover("2026-12"), "pending");
    assert.equal(await cover("2026-11"), "complete");
    await syncRecurrences(db, user, WIDE);
    assert.equal(await cover("2026-12"), "complete");

    await moveCompetence(db, user, { item_id: (await at(db, "2026-11-25")).item, version: 1, month: "2027-02", due_date: null });
    assert.equal(await cover("2026-12"), "complete");
  } finally {
    await db.close();
  }
});

test("série no cartão: competência pela fatura, sem ciclo pelo mês da cobrança, prévia não marca editada", async () => {
  const db = await openDatabase();
  try {
    const { user, make } = await setup(db, "card");
    const card = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
      [card, user.familyId, user.userId],
    );
    const plain = await make({ account_id: card, start_date: "2026-11-28", frequency: "year" });
    const noCycle = await at(db, "2026-11-28");
    assert.equal(noCycle.month, "2026-11-01");
    assert.equal(noCycle.due, "2026-11-28");

    await saveCardCycle(db, user, { account_id: card, close_date: "2026-10-25", due_date: "2026-11-10" }, { today: "2026-10-01" });
    const { recurrence_id } = await make({ account_id: card, label: "Streaming", start_date: "2026-11-28", frequency: "year" });
    const withCycle = (await slots(db, "o.recurrence_id=$1", [recurrence_id]))[0];
    assert.equal(withCycle.month, "2027-01-01");
    assert.equal(withCycle.due, "2027-01-10");

    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-11-01" });
    assert.equal(preview.groups.edited.length, 0);
    assert.equal(preview.groups.replaced.length, 1);
    assert.ok(plain.recurrence_id);
  } finally {
    await db.close();
  }
});

test("generatedItem: entrada planeja pelo mês da ocorrência + offset; despesa segue a data prevista", () => {
  const base: RecurrenceRow = {
    id: "r", household_id: "h", purpose: "income", label: "Salário", category_id: null, account_id: null,
    expected_cents: "1000", frequency: "month", every: 1, start_date: "2026-01-01", end_date: null,
    paused: false, date_rule: "weekend_to_friday", planning_offset: 0, match_text: null,
  };
  const income0 = generatedItem(base, "2026-08-01");
  assert.equal(income0.expected_date, "2026-07-31");
  assert.equal(income0.month, "2026-08-01");
  assert.equal(generatedItem({ ...base, planning_offset: 1 }, "2026-08-01").month, "2026-09-01");
  assert.equal(generatedItem({ ...base, planning_offset: 1 }, "2026-11-10").month, "2026-12-01");
  const expense = generatedItem({ ...base, purpose: "expense", category_id: "c" }, "2026-08-01");
  assert.equal(expense.expected_date, "2026-07-31");
  assert.equal(expense.month, "2026-07-01");
  assert.equal(expense.due_date, "2026-07-31");
});
