import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { readBudgets } from "../src/server/budgets.ts";
import { readState } from "../src/server/state.ts";
import {
  categoryOutflow,
  commitment,
  openPlannedCents,
  pickCeiling,
  UNCATEGORIZED,
  type CommitmentItem,
} from "../src/domain/budget.ts";

const item = (over: Partial<CommitmentItem> = {}): CommitmentItem => ({
  purpose: "expense",
  planned_cents: "15000",
  paid_cents: null,
  archived: false,
  derived: false,
  event_id: null,
  ...over,
});

test("pickCeiling: vale a linha mais recente <= mês; null encerra o teto", () => {
  const rows = [
    { month: "2026-09-01", planned_cents: "100000" },
    { month: "2026-12-01", planned_cents: null },
  ];
  assert.equal(pickCeiling(rows, "2026-08-01").ceiling_cents, null);
  assert.equal(pickCeiling(rows, "2026-10-01").ceiling_cents, 100000n);
  assert.equal(pickCeiling(rows, "2026-11-01").from, "2026-09-01");
  assert.equal(pickCeiling(rows, "2026-12-01").ceiling_cents, null);
  assert.equal(pickCeiling(rows, "2027-02-01").ceiling_cents, null);
});

test("openPlannedCents: aberto, parcial, derivado, arquivado e conciliado", () => {
  assert.equal(openPlannedCents([item()]), 15000n);
  assert.equal(openPlannedCents([item({ paid_cents: "4000" })]), 11000n);
  assert.equal(openPlannedCents([item({ paid_cents: "20000" })]), 0n);
  assert.equal(openPlannedCents([item({ derived: true })]), 0n);
  assert.equal(openPlannedCents([item({ archived: true })]), 0n);
  assert.equal(openPlannedCents([item({ event_id: "e1" })]), 0n);
  // Parcial ligado a evento: o restante continua devido; concluído ligado não.
  assert.equal(openPlannedCents([item({ event_id: "e1", status: "partial", paid_cents: "6000" })]), 9000n);
  assert.equal(openPlannedCents([item({ event_id: "e1", status: "done", paid_cents: "6000" })]), 0n);
  assert.equal(openPlannedCents([item({ purpose: "income" })]), 0n);
  assert.equal(openPlannedCents([item({ purpose: "benefit" })]), 15000n);
});

test("commitment: conciliado conta 165, não 315; over quando passa do teto", () => {
  const c = commitment({
    ceiling_cents: 16000n,
    realized_cents: 16500n,
    items: [item({ event_id: "e1" })],
  });
  assert.equal(c.committed_cents, 16500n);
  assert.equal(c.over, true);
  const open = commitment({
    ceiling_cents: 30000n,
    realized_cents: 10000n,
    items: [item()],
  });
  assert.equal(open.committed_cents, 25000n);
  assert.equal(open.remaining_cents, 5000n);
  assert.equal(open.over, false);
  assert.equal(
    commitment({ ceiling_cents: null, realized_cents: 1n, items: [] }).over,
    false,
  );
});

async function setup(db: PGlite, tag: string) {
  const email = `budget-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (
    await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Moradia'", [user.familyId])
  ).rows[0].id;
  const ceiling = (month: string, cents: number | null) =>
    db.query(
      "INSERT INTO budgets(household_id,category_id,month,currency,planned_cents) VALUES($1,$2,$3,'BRL',$4) ON CONFLICT(household_id,category_id,month,currency) DO UPDATE SET planned_cents=EXCLUDED.planned_cents",
      [user.familyId, category, month, cents],
    );
  const addItem = (month: string, label: string, planned: number, extra: { paid?: number; derived?: boolean; archived?: boolean; event?: string } = {}) =>
    db.query(
      "INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,paid_cents,category_id,derived,archived,event_id,created_by) VALUES($1,$2,$3,$4,'expense','BRL',$5,$6,$7,$8,$9,$10,$11)",
      [randomUUID(), user.familyId, month, label, planned, extra.paid ?? null, category, extra.derived ?? false, extra.archived ?? false, extra.event ?? null, userId],
    );
  const read = (month: string, spent = 0n) =>
    asUser(db, userId, (tx) => readBudgets(tx, user.familyId, month, "BRL", new Map([[category, spent]])));
  return { user, userId, category, ceiling, addItem, read };
}

test("teto de setembro vale em outubro e novembro; 'sem teto' a partir de dezembro some", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "ceiling");
    await f.ceiling("2026-09-01", 100000);
    assert.equal((await f.read("2026-08-01")).length, 0);
    for (const m of ["2026-09-01", "2026-10-01", "2026-11-01"]) {
      const [b] = await f.read(m);
      assert.equal(b.planned_cents, "100000", m);
      assert.equal(b.ceiling_from, "2026-09-01", m);
    }
    await f.ceiling("2026-12-01", null);
    assert.equal((await f.read("2026-11-01")).length, 1);
    assert.equal((await f.read("2026-12-01")).length, 0);
    assert.equal((await f.read("2027-03-01")).length, 0);
    await f.ceiling("2027-02-01", 50000);
    assert.equal((await f.read("2027-03-01"))[0].planned_cents, "50000");
  } finally {
    await db.close();
  }
});

test("readBudgets: previsto em aberto entra; parcial só o restante; derivado/arquivado/conciliado não", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "open");
    await f.ceiling("2026-11-01", 20000);
    await f.addItem("2026-11-01", "Luz", 15000);
    await f.addItem("2026-11-01", "Água", 10000, { paid: 4000 });
    await f.addItem("2026-11-01", "Derivado", 99000, { derived: true });
    await f.addItem("2026-11-01", "Arquivado", 99000, { archived: true });
    await f.addItem("2026-10-01", "Outro mês", 99000);
    const [b] = await f.read("2026-11-01", 3000n);
    assert.equal(b.open_planned_cents, "21000");
    assert.equal(b.committed_cents, "24000");
    assert.equal(b.spent_cents, "3000");
    assert.equal(b.remaining_cents, "17000");
    assert.equal(b.over, true);
  } finally {
    await db.close();
  }
});

test("readState: R$165 conciliado a previsto R$150 = comprometido 165; alerta usa comprometido", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "state");
    const bank = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3)",
      [bank, f.user.familyId, f.userId],
    );
    const eventId = randomUUID();
    await asUser(db, f.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense','2026-11-05','LUZ','LUZ',-16500,'BRL',$4,$5)`,
        [eventId, f.user.familyId, bank, f.category, f.userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',-16500,'2026-11-05'),($5,$2,$3,NULL,'expense','BRL',16500,'2026-11-05')`,
        [randomUUID(), f.user.familyId, eventId, bank, randomUUID()],
      );
    });
    await f.addItem("2026-11-01", "Luz", 15000, { event: eventId });
    await f.ceiling("2026-11-01", 20000);
    let state = await readState(db, f.user, "2026-11-01", "BRL");
    const b = state.budgets[0];
    assert.equal(b.spent_cents, "16500");
    assert.equal(b.committed_cents, "16500");
    assert.equal(b.over, false);
    // campos antigos seguem presentes para help/retrieval/alertas
    for (const k of ["category_id", "category_name", "planned_cents", "spent_cents", "remaining_cents"])
      assert.ok(k in b, k);
    await f.addItem("2026-11-01", "Internet", 5000);
    state = await readState(db, f.user, "2026-11-01", "BRL");
    assert.equal(state.budgets[0].committed_cents, "21500");
    assert.equal(state.budgets[0].over, true);
    assert.equal(state.budgets[0].remaining_cents, "3500");
    const alert = state.insights.find((i) => i.type === "budget");
    assert.match(alert?.fact ?? "", /previsto em aberto/);
  } finally {
    await db.close();
  }
});

test("criar série não escreve em budgets; planned null é aceito pelo banco", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "series");
    await f.ceiling("2026-11-01", 20000);
    const count = async () =>
      (await db.query<{ n: number }>("SELECT count(*)::integer AS n FROM budgets WHERE household_id=$1", [f.user.familyId])).rows[0].n;
    const before = await count();
    await createRecurrence(db, f.user, { purpose: "expense", label: "Aluguel", category_id: f.category, expected_cents: 100000, frequency: "month", start_date: "2026-11-05", today: "2026-11-11" });
    assert.equal(await count(), before);
    await assert.rejects(f.ceiling("2026-12-01", -1));
    await f.ceiling("2026-12-01", null);
    assert.equal(await count(), before + 1);
  } finally {
    await db.close();
  }
});

test("categoryOutflow: comprometido por categoria, com e sem teto; sem categoria junto em null", () => {
  const rows = categoryOutflow(
    new Map([
      ["moradia", 30000n],
      [UNCATEGORIZED, 5000n],
      ["vazia", 0n],
    ]),
    [
      { ...item({ planned_cents: "10000" }), category_id: "moradia" },
      { ...item({ planned_cents: "2000" }), category_id: null },
      { ...item({ planned_cents: "7000" }), category_id: "lazer" },
      { ...item({ event_id: "e1" }), category_id: "moradia" },
    ],
  );
  const by = new Map(rows.map((r) => [r.category_id, r]));
  assert.equal(by.get("moradia")?.committed_cents, 40000n);
  assert.equal(by.get("lazer")?.realized_cents, 0n);
  assert.equal(by.get("lazer")?.committed_cents, 7000n);
  assert.equal(by.get(null)?.committed_cents, 7000n);
  assert.equal(by.has("vazia"), false);
});

test("categoryOutflow: agendado passa do realizado para o a pagar; comprometido igual", () => {
  const rows = categoryOutflow(
    new Map([["edu", 45000n], ["casa", 30000n]]),
    [{ ...item({ planned_cents: "23000" }), category_id: "casa" }],
    new Map([["edu", 45000n]]),
  );
  const by = new Map(rows.map((r) => [r.category_id, r]));
  assert.equal(by.get("edu")?.realized_cents, 0n);
  assert.equal(by.get("edu")?.open_planned_cents, 45000n);
  assert.equal(by.get("edu")?.committed_cents, 45000n);
  assert.equal(by.get("casa")?.realized_cents, 30000n);
  assert.equal(by.get("casa")?.open_planned_cents, 23000n);
});

test("readState: outflow traz categoria sem teto e saída sem categoria; teto e outflow batem", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "outflow");
    const bank = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3)",
      [bank, f.user.familyId, f.userId],
    );
    const spend = (cents: number, category: string | null) =>
      asUser(db, f.userId, async (tx) => {
        const id = randomUUID();
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
           VALUES($1,$2,$3,'expense','2026-11-05','X','X',$4,'BRL',$5,$6)`,
          [id, f.user.familyId, bank, -cents, category, f.userId],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',$5,'2026-11-05'),($6,$2,$3,NULL,'expense','BRL',$7,'2026-11-05')`,
          [randomUUID(), f.user.familyId, id, bank, -cents, randomUUID(), cents],
        );
      });
    await spend(12000, f.category);
    await spend(3000, null);
    await f.addItem("2026-11-01", "Internet", 5000);
    await f.ceiling("2026-11-01", 20000);
    const state = await readState(db, f.user, "2026-11-01", "BRL");
    const moradia = state.outflow.find((o) => o.category_id === f.category);
    assert.equal(moradia?.committed_cents, "17000");
    assert.equal(moradia?.committed_cents, state.budgets[0].committed_cents);
    assert.equal(state.outflow.find((o) => o.category_id === null)?.spent_cents, "3000");
    assert.equal(state.competenceSpending.total_cents, state.summary.expense_cents);
  } finally {
    await db.close();
  }
});
