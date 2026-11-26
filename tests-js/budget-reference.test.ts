import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { readBudgetReference } from "../src/server/budget-reference.ts";
import { allowedMethods } from "../src/server/api-policy.ts";

const TODAY = "2026-11-15";

async function family(db: Awaited<ReturnType<typeof openDatabase>>, tag: string) {
  const email = `ref-${tag}@example.invalid`;
  await createFamily(db, {
    email,
    name: tag,
    password: "SenhaFicticia!2026",
    familyName: `Família ${tag}`,
  });
  const userId = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])
  ).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const run = (sql: string, params: unknown[] = []) =>
    asUser(db, user.userId, (tx) => tx.query(sql, params));
  const account = randomUUID();
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',$3)",
    [account, user.familyId, user.userId],
  );
  const category = randomUUID();
  await run(
    "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Mercado')",
    [category, user.familyId],
  );
  const spend = async (date: string, cents: number) => {
    const id = randomUUID();
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,category_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
         VALUES($1,$2,$3,$4,'expense',$5,'MERCADO','MERCADO',$6,'BRL',$7)`,
        [id, user.familyId, account, category, date, -cents, user.userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$5,$6),($7,$2,$3,NULL,'expense','BRL',$8,$6)`,
        [randomUUID(), user.familyId, id, account, -cents, date, randomUUID(), cents],
      );
    });
  };
  return { user, category, spend };
}

test("referência: mediana e maior dos 6 meses fechados, zeros depois do primeiro gasto, mês atual fora, outra família fora", async () => {
  const db = await openDatabase();
  try {
    const a = await family(db, "a");
    const b = await family(db, "b");
    // Maio/2026 sem gasto (antes do primeiro gasto: não conta). Jun a out: 6 meses
    // fechados são mai..out; mai vazio é descartado, nov (atual) é ignorado.
    await a.spend("2026-06-10", 100000);
    await a.spend("2026-07-10", 200000);
    // agosto sem gasto: conta como 0
    await a.spend("2026-09-10", 300000);
    await a.spend("2026-09-20", 100000);
    await a.spend("2026-10-05", 50000);
    await a.spend("2026-11-02", 999999);
    await b.spend("2026-09-10", 777777);

    const ref = await readBudgetReference(
      db,
      a.user,
      { category_id: a.category, month: "2026-11" },
      { today: TODAY },
    );
    assert.deepEqual(
      ref.months.map((m) => [m.month, m.cents]),
      [
        ["2026-06", "100000"],
        ["2026-07", "200000"],
        ["2026-08", "0"],
        ["2026-09", "400000"],
        ["2026-10", "50000"],
      ],
    );
    // ordenado: 0, 50000, 100000, 200000, 400000 -> mediana 100000
    assert.equal(ref.median_cents, "100000");
    assert.equal(ref.max_cents, "400000");

    // Categoria de outra família não existe para quem pergunta.
    const foreign = await readBudgetReference(
      db,
      a.user,
      { category_id: b.category, month: "2026-11" },
      { today: TODAY },
    );
    assert.equal(foreign.median_cents, null);
    assert.deepEqual(foreign.months, []);
  } finally {
    await db.close();
  }
});

test("referência: menos de 3 meses contados não sugere", async () => {
  const db = await openDatabase();
  try {
    const a = await family(db, "c");
    await a.spend("2026-09-10", 100000);
    await a.spend("2026-10-10", 200000);
    const ref = await readBudgetReference(
      db,
      a.user,
      { category_id: a.category, month: "2026-11" },
      { today: TODAY },
    );
    assert.equal(ref.median_cents, null);
    assert.equal(ref.max_cents, null);
    assert.equal(ref.months.length, 2);
  } finally {
    await db.close();
  }
});

test("rota budgets/reference é só leitura", () => {
  assert.deepEqual(allowedMethods("budgets/reference"), ["GET"]);
});
