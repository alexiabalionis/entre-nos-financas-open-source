import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity, type Identity } from "../src/server/auth.ts";
import { UserError } from "../src/server/imports.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { AlreadyInSeriesError, createFromEvent } from "../src/server/recurrence-from-event.ts";

const TODAY = "2026-11-09";

async function setup(db: PGlite, tag: string) {
  const email = `from-event-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 LIMIT 1", [user.familyId])).rows[0].id;
  const account = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Conta','Teste','BRL','checking',$3)",
    [account, user.familyId, user.userId],
  );
  const event = (over: Record<string, unknown> = {}) =>
    asUser(db, user.userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account, date: "2026-11-05", description: "ACADEMIA XYZ", amount: "-150,00", kind: "expense",
        category_id: category, counter_account_id: null, counter_currency: null, counter_amount: null, related_event_id: null, ...over,
      }),
    );
  const from = (event_id: unknown, over: Record<string, unknown> = {}) =>
    createFromEvent(db, user, { event_id, frequency: "month", today: TODAY, ...over });
  return { user, category, account, event, from };
}

const items = async (db: PGlite) => (await db.query<{ n: number }>("SELECT count(*)::int n FROM monthly_items")).rows[0].n;
const created = (r: Awaited<ReturnType<typeof createFromEvent>>) => {
  assert.ok("recurrence_id" in r);
  return r;
};

test("evento sem item: cria 1 item realizado e conciliado e as futuras", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "new");
    const id = (await event()) as string;
    const before = await items(db);
    const { recurrence_id, created: n } = created(await from(id));
    assert.equal(n, 3);
    assert.equal(await items(db), before + 3);
    const first = (await db.query<Record<string, string>>(
      `SELECT i.status, i.paid_cents::text, i.paid_date::text, i.event_id, i.month::text, i.due_date::text
         FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id
        WHERE o.recurrence_id=$1 ORDER BY o.occurrence_date LIMIT 1`,
      [recurrence_id],
    )).rows[0];
    assert.deepEqual(first, { status: "done", paid_cents: "15000", paid_date: "2026-11-05", event_id: id, month: "2026-11-01", due_date: "2026-11-05" });
    const series = (await db.query<{ source_event_id: string; match_text: string; expected_cents: string }>(
      "SELECT source_event_id, match_text, expected_cents::text FROM recurrences WHERE id=$1", [recurrence_id])).rows[0];
    assert.equal(series.source_event_id, id);
    assert.equal(series.expected_cents, "15000");
    assert.ok(series.match_text);
    assert.equal((await db.query("SELECT 1 FROM economic_events")).rows.length, 1);
    assert.equal((await db.query("SELECT 1 FROM audit_events WHERE action='recurrence.from_event'")).rows.length, 1);
  } finally {
    await db.close();
  }
});

test("evento com item existente: reaproveita sem alterar o item", async () => {
  const db = await openDatabase();
  try {
    const { user, category, event, from } = await setup(db, "reuse");
    const id = (await event()) as string;
    const itemId = randomUUID();
    await db.query(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,status,paid_cents,paid_date,event_id,created_by)
       VALUES($1,$2,'2026-11-01','Academia','expense','BRL',14000,$3,'done',15000,'2026-11-05',$4,$5)`,
      [itemId, user.familyId, category, id, user.userId],
    );
    const before = await items(db);
    const { recurrence_id, created: n } = created(await from(id));
    assert.equal(n, 3);
    assert.equal(await items(db), before + 2);
    const linked = (await db.query<{ item: string }>(
      "SELECT monthly_item_id item FROM recurrence_occurrences WHERE recurrence_id=$1 AND occurrence_date='2026-11-05'", [recurrence_id])).rows[0];
    assert.equal(linked.item, itemId);
    const item = (await db.query<Record<string, string>>(
      "SELECT planned_cents::text, paid_cents::text, status, version::text, label FROM monthly_items WHERE id=$1", [itemId])).rows[0];
    assert.deepEqual(item, { planned_cents: "14000", paid_cents: "15000", status: "done", version: "1", label: "Academia" });
  } finally {
    await db.close();
  }
});

test("evento já em série vira erro tipado com o id da série", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "dup");
    const id = (await event()) as string;
    const { recurrence_id } = created(await from(id));
    await assert.rejects(
      () => from(id, { confirm: true }),
      (e) => e instanceof AlreadyInSeriesError && e.recurrenceId === recurrence_id && e.message === "Essa transação já faz parte de uma conta fixa.",
    );
  } finally {
    await db.close();
  }
});

test("conflito sem confirm não grava; com confirm grava", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "conflict");
    const first = created(await from((await event()) as string));
    const second = (await event({ date: "2026-11-06" })) as string;
    const before = await items(db);
    const res = await from(second);
    assert.ok("conflict" in res);
    assert.deepEqual(res.conflict.map((c) => c.recurrence_id), [first.recurrence_id]);
    assert.equal(await items(db), before);
    assert.equal((await db.query("SELECT 1 FROM recurrences")).rows.length, 1);
    created(await from(second, { confirm: true }));
    assert.equal((await db.query("SELECT 1 FROM recurrences")).rows.length, 2);
  } finally {
    await db.close();
  }
});

test("recusa evento de outra família, outra moeda, outro tipo, inexistente e leitor", async () => {
  const db = await openDatabase();
  try {
    const a = await setup(db, "guard-a");
    const b = await setup(db, "guard-b");
    const foreign = (await b.event()) as string;
    await assert.rejects(() => a.from(foreign), UserError);
    await assert.rejects(() => a.from(randomUUID()), /aprove antes/);
    const income = (await a.event({ kind: "income", amount: "150,00" })) as string;
    await assert.rejects(() => a.from(income), UserError);
    const usdAccount = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Dólar','Teste','USD','checking',$3)",
      [usdAccount, a.user.familyId, a.user.userId],
    );
    const usd = (await a.event({ account_id: usdAccount, amount: "-10,00" })) as string;
    await assert.rejects(() => a.from(usd), /reais/);
    const brl = (await a.event()) as string;
    const reader: Identity = { ...a.user, role: "reader" };
    await assert.rejects(() => createFromEvent(db, reader, { event_id: brl, frequency: "month" }), /leitura/);
    assert.equal((await db.query("SELECT 1 FROM recurrences")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("evento antigo: não inventa passado, só liga o evento e segue da janela do sync global", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "past");
    const id = (await event({ date: "2026-08-10" })) as string;
    const { recurrence_id, source_linked } = created(await from(id, { today: "2026-11-11" }));
    assert.equal(source_linked, true);
    const dates = (await db.query<{ d: string }>(
      "SELECT occurrence_date::text d FROM recurrence_occurrences WHERE recurrence_id=$1 ORDER BY occurrence_date", [recurrence_id])).rows.map((r) => r.d);
    assert.deepEqual(dates, ["2026-08-10", "2026-10-10", "2026-11-10", "2026-12-10", "2027-01-10"]);
    const linked = (await db.query<{ event_id: string }>(
      `SELECT i.event_id FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id
        WHERE o.recurrence_id=$1 AND o.occurrence_date='2026-08-10'`, [recurrence_id])).rows[0];
    assert.equal(linked.event_id, id);
  } finally {
    await db.close();
  }
});

test("início antes da transação de origem é recusado sem gravar", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "early");
    const id = (await event()) as string;
    await assert.rejects(
      () => from(id, { start_date: "2026-10-05" }),
      (e) => e instanceof UserError && e.message === "O início da conta fixa não pode ser antes da transação de origem.",
    );
    assert.equal((await db.query("SELECT 1 FROM recurrences")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("auditoria registra confirm e conflitos ignorados", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "audit");
    created(await from((await event()) as string));
    created(await from((await event({ date: "2026-11-06" })) as string, { confirm: true }));
    const rows = (await db.query<{ metadata: { confirm: boolean; conflicts_ignored: number } }>(
      "SELECT metadata FROM audit_events WHERE action='recurrence.from_event' ORDER BY created_at, id")).rows;
    assert.equal(rows.length, 2);
    const meta = rows.map((r) => ({ confirm: r.metadata.confirm, conflicts_ignored: r.metadata.conflicts_ignored }));
    assert.deepEqual(meta.sort((a, b) => a.conflicts_ignored - b.conflicts_ignored), [
      { confirm: false, conflicts_ignored: 0 },
      { confirm: true, conflicts_ignored: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("início depois do evento nasce sem ligar o evento e avisa", async () => {
  const db = await openDatabase();
  try {
    const { event, from } = await setup(db, "unlinked");
    const id = (await event()) as string;
    const res = created(await from(id, { start_date: "2026-12-05" }));
    assert.equal(res.source_linked, false);
    const linked = await db.query(
      `SELECT 1 FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id
        WHERE o.recurrence_id=$1 AND i.event_id=$2`, [res.recurrence_id, id]);
    assert.equal(linked.rows.length, 0);
  } finally {
    await db.close();
  }
});
