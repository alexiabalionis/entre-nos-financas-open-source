import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { fixedEventIds } from "../src/server/fixed-events.ts";
import { readInsights } from "../src/server/insights.ts";
import { readRoutine } from "../src/server/routine.ts";
import { readState } from "../src/server/state.ts";

// 4a: uma única regra de transação fixa = evento conciliado a um item que é
// ocorrência de uma série de despesa. Hoje fixo em 2026-11-11.
const TODAY = "2026-11-11";

async function setup(db: PGlite, tag: string) {
  const email = `fixed-events-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (
    await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Moradia'", [user.familyId])
  ).rows[0].id;
  const bank = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3)",
    [bank, user.familyId, userId],
  );
  const event = (date: string, cents: number, description: string) =>
    asUser(db, userId, async (tx) => {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
        [id, user.familyId, bank, date, description, -cents, category, userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,'expense','BRL',$7,$8)`,
        [randomUUID(), user.familyId, id, bank, randomUUID(), -cents, cents, date],
      );
      return id;
    });
  const itemOf = async (label: string) =>
    (await db.query<{ id: string }>("SELECT id FROM monthly_items WHERE household_id=$1 AND label=$2 AND month='2026-11-01'", [user.familyId, label])).rows[0].id;
  const link = (itemId: string, eventId: string) => db.query("UPDATE monthly_items SET event_id=$1 WHERE id=$2", [eventId, itemId]);
  const series = (label: string) =>
    createRecurrence(db, user, { purpose: "expense", label, category_id: category, expected_cents: 100000, frequency: "month", start_date: "2026-11-05", today: TODAY });
  return { user, event, itemOf, link, series, category };
}

test("4a: fixedEventIds: conciliado a série é fixo; a item avulso e despesa sem vínculo não são", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "regra");
    await f.series("Aluguel");
    const plain = randomUUID();
    await db.query(
      "INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,created_by) VALUES($1,$2,'2026-11-01','Avulso','expense','BRL',5000,$3,$4)",
      [plain, f.user.familyId, f.category, f.user.userId],
    );
    const rent = await f.event("2026-11-05", 100000, "ALUGUEL");
    const oneOff = await f.event("2026-11-06", 5000, "REFORMA");
    const loose = await f.event("2026-11-07", 7000, "MERCADO");
    await f.link(await f.itemOf("Aluguel"), rent);
    await f.link(plain, oneOff);

    const all = await asUser(db, f.user.userId, (tx) => fixedEventIds(tx, f.user.familyId));
    assert.deepEqual([...all], [rent]);
    const some = await asUser(db, f.user.userId, (tx) => fixedEventIds(tx, f.user.familyId, [oneOff, loose]));
    assert.equal(some.size, 0);
    const none = await asUser(db, f.user.userId, (tx) => fixedEventIds(tx, f.user.familyId, []));
    assert.equal(none.size, 0);

    // Arquivar a ocorrência desliga a regra para aquele evento.
    await db.query("UPDATE monthly_items SET archived=true WHERE id=$1", [await f.itemOf("Aluguel")]);
    assert.equal((await asUser(db, f.user.userId, (tx) => fixedEventIds(tx, f.user.familyId))).size, 0);
  } finally {
    await db.close();
  }
});

test("4a: o estado marca o evento como fixo só quando ele é de série; Panorama separa fixo e dia a dia por evento", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "estado");
    await f.series("Aluguel");
    const rent = await f.event("2026-11-05", 100000, "ALUGUEL");
    // Mesma categoria (Moradia), sem série: dia a dia.
    const reform = await f.event("2026-11-06", 30000, "REFORMA");
    await f.link(await f.itemOf("Aluguel"), rent);

    const state = await readState(db, f.user, "2026-11-01", "BRL", undefined, undefined, false);
    const fixedFlags = Object.fromEntries(state.events.map((e) => [e.id, e.fixed]));
    assert.deepEqual(fixedFlags, { [rent]: true, [reform]: false });

    const insights = await readInsights(db, f.user, { today: TODAY });
    assert.equal(insights.fixed.fixed, 100000n);
    assert.equal(insights.fixed.everyday, 30000n);
  } finally {
    await db.close();
  }
});

test("4a: ler family/month não escreve: nenhum item é criado nem apagado", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "leitura");
    // Categoria marcada como fixa com gasto no mês: antes, abrir o mês criava um item derivado.
    await db.query("UPDATE categories SET fixed=true WHERE id=$1", [f.category]);
    await f.event("2026-11-05", 90000, "ALUGUEL");
    const legacy = randomUUID();
    await db.query(
      "INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,created_by,cost_type,derived) VALUES($1,$2,'2026-11-01','Moradia','expense','BRL',80000,$3,$4,'fixed',true)",
      [legacy, f.user.familyId, f.category, f.user.userId],
    );
    const count = async () =>
      (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM monthly_items WHERE household_id=$1", [f.user.familyId])).rows[0].n;
    const before = await count();
    const month = await readRoutine(db, f.user, "2026-11");
    assert.equal(await count(), before);
    assert.equal(month.items.length, 1, "o derivado antigo continua como histórico, intacto");
    assert.equal(month.items[0].planned_cents, "80000");
  } finally {
    await db.close();
  }
});
