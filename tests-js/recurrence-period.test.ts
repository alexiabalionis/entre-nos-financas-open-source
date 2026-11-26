import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { createFromEvent } from "../src/server/recurrence-from-event.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { setAmountAll, setSince } from "../src/server/recurrence-period.ts";
import { startBackTo, type RecurrenceRule } from "../src/domain/recurrence.ts";

const TODAY = "2026-11-09";

async function setup(db: PGlite, tag: string) {
  const email = `period-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 LIMIT 1", [user.familyId])).rows[0].id;
  const account = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Conta','Teste','BRL','checking',$3)",
    [account, user.familyId, user.userId],
  );
  const event = (date: string, amount = "-150,00", description = "ACADEMIA XYZ") =>
    asUser(db, user.userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account, date, description, amount, kind: "expense",
        category_id: category, counter_account_id: null, counter_currency: null, counter_amount: null, related_event_id: null,
      }),
    ) as Promise<string>;
  return { user, category, account, event };
}

type Row = { month: string; status: string; planned: string; paid: string | null; event_id: string | null };
const months = async (db: PGlite, recurrenceId: string) =>
  (
    await db.query<Row>(
      `SELECT i.month::text AS month, i.status, i.planned_cents::text AS planned, i.paid_cents::text AS paid, i.event_id
         FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id
        WHERE o.recurrence_id=$1 AND NOT i.archived ORDER BY o.occurrence_date`,
      [recurrenceId],
    )
  ).rows;

const rule = (startDate: string, frequency: RecurrenceRule["frequency"] = "month", every = 1): RecurrenceRule => ({
  frequency, every, startDate, endDate: null, dateRule: "exact", planningOffset: 0,
});

test("startBackTo recua no mesmo calendário sem mudar o dia", () => {
  assert.equal(startBackTo(rule("2026-11-05"), "2026-08-01"), "2026-08-05");
  assert.equal(startBackTo(rule("2026-11-05"), "2026-08-06"), "2026-09-05");
  assert.equal(startBackTo(rule("2026-11-05"), "2026-12-01"), "2026-11-05");
  // Dia 31: pula os meses curtos em vez de virar dia 30.
  assert.equal(startBackTo(rule("2026-12-31"), "2026-09-01"), "2026-10-31");
  assert.equal(startBackTo(rule("2026-11-05", "month", 2), "2026-08-01"), "2026-09-05");
  assert.equal(startBackTo(rule("2026-11-04", "week"), "2026-10-20"), "2026-10-21");
});

test("desde: vincula o pagamento real do mês passado e marca pago sem lançamento onde não há", async () => {
  const db = await openDatabase();
  try {
    const { user, event } = await setup(db, "since");
    const source = await event("2026-11-05");
    const september = await event("2026-09-06", "-152,00");
    const r = await createFromEvent(db, user, { event_id: source, frequency: "month", today: TODAY, since_month: "2026-08" });
    assert.ok("recurrence_id" in r);
    const rows = await months(db, r.recurrence_id);
    assert.deepEqual(
      rows.slice(0, 4).map((x) => [x.month, x.status, x.paid, x.event_id]),
      [
        ["2026-08-01", "done", "15000", null],
        ["2026-09-01", "done", "15200", september],
        ["2026-10-01", "done", "15000", null],
        ["2026-11-01", "done", "15000", source],
      ],
    );
    assert.equal(rows[4].status, "open");
    const start = (await db.query<{ s: string }>("SELECT start_date::text s FROM recurrences WHERE id=$1", [r.recurrence_id])).rows[0].s;
    assert.equal(start, "2026-08-05");
  } finally {
    await db.close();
  }
});

test("desde numa conta existente e valor de todas", async () => {
  const db = await openDatabase();
  try {
    const { user, category, account } = await setup(db, "existing");
    const made = await createRecurrence(db, user, {
      purpose: "expense", label: "Aluguel", category_id: category, account_id: account,
      expected_cents: 200000, frequency: "month", start_date: "2026-11-10", today: TODAY,
    });
    await assert.rejects(setSince(db, user, { recurrence_id: made.recurrence_id, since_month: "2026-12", today: TODAY }));
    const moved = await setSince(db, user, { recurrence_id: made.recurrence_id, since_month: "2026-09", today: TODAY });
    assert.equal(moved.start_date, "2026-09-10");
    let rows = await months(db, made.recurrence_id);
    assert.deepEqual(rows.slice(0, 2).map((x) => [x.month, x.status, x.paid]), [
      ["2026-09-01", "done", "200000"],
      ["2026-10-01", "done", "200000"],
    ]);
    const all = await setAmountAll(db, user, { recurrence_id: made.recurrence_id, expected_cents: 210000 });
    assert.equal(all.updated, rows.length);
    rows = await months(db, made.recurrence_id);
    assert.ok(rows.every((x) => x.planned === "210000"));
    assert.equal(rows[0].paid, "210000");
    const expected = (await db.query<{ c: string }>("SELECT expected_cents::text c FROM recurrences WHERE id=$1", [made.recurrence_id])).rows[0].c;
    assert.equal(expected, "210000");
  } finally {
    await db.close();
  }
});

test("valor de todas não mexe em mês com pagamento real nem no pago à mão com outro valor", async () => {
  const db = await openDatabase();
  try {
    const { user, event } = await setup(db, "keep");
    const source = await event("2026-11-05");
    const r = await createFromEvent(db, user, { event_id: source, frequency: "month", today: TODAY });
    assert.ok("recurrence_id" in r);
    const next = (await months(db, r.recurrence_id))[1];
    assert.equal(next.status, "open");
    await db.query(
      `UPDATE monthly_items i SET status='done', paid_cents=14000, paid_date='2026-12-04'
         FROM recurrence_occurrences o WHERE o.monthly_item_id=i.id AND o.recurrence_id=$1 AND i.month='2026-12-01'`,
      [r.recurrence_id],
    );
    const all = await setAmountAll(db, user, { recurrence_id: r.recurrence_id, expected_cents: 16000 });
    const rows = await months(db, r.recurrence_id);
    assert.equal(rows[0].planned, "15000");
    assert.equal(rows[0].event_id, source);
    assert.equal(rows[1].paid, "14000");
    assert.equal(all.updated, rows.length - 2);
  } finally {
    await db.close();
  }
});

test("ligar lançamento a conta fixa existente: concilia o mês mais perto e recusa sem mês livre", async () => {
  const { linkEventToSeries } = await import("../src/server/recurrence-link.ts");
  const db = await openDatabase();
  try {
    const { user, category, account, event } = await setup(db, "link");
    const made = await createRecurrence(db, user, {
      purpose: "expense", label: "Votorantim", category_id: category, account_id: account,
      expected_cents: 18990, frequency: "month", start_date: "2026-11-10", today: TODAY,
    });
    const paid = await event("2026-11-12", "-191,40", "VOTORANTIM S.A.");
    const linked = await linkEventToSeries(db, user, { event_id: paid, recurrence_id: made.recurrence_id });
    assert.equal(linked.month, "2026-11-01");
    const rows = await months(db, made.recurrence_id);
    assert.deepEqual([rows[0].status, rows[0].paid, rows[0].event_id], ["done", "19140", paid]);
    const far = await event("2026-03-12", "-190,00", "VOTORANTIM S.A.");
    await assert.rejects(linkEventToSeries(db, user, { event_id: far, recurrence_id: made.recurrence_id }), /Desde quando/);
    await assert.rejects(linkEventToSeries(db, user, { event_id: paid, recurrence_id: made.recurrence_id }));
  } finally {
    await db.close();
  }
});
