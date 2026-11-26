import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser, type Database } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import {
  dismissSuggestion,
  listDismissed,
  restoreSuggestions,
} from "../src/server/dismissed-suggestions.ts";
import { readFuture } from "../src/server/future-plan.ts";
import { decodeFutureInput, encodeFutureInput } from "../app/future/decode.ts";

async function member(db: Database, email: string) {
  await createFamily(db, { email, name: "N", password: "SenhaFicticia!2026", familyName: "F" });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  return (await identity(db, await issueSession(db, userId)))!;
}

test("sugestões dispensadas: lista, atualiza, restaura e isola por casa", async () => {
  const db = await openDatabase();
  try {
    const a = await member(db, "dismiss-a@example.invalid");
    const b = await member(db, "dismiss-b@example.invalid");
    assert.deepEqual(await listDismissed(db, a), []);
    await dismissSuggestion(db, a, { id: "cut:Lazer", metric: "12345" });
    assert.deepEqual(await listDismissed(db, a), [{ id: "cut:Lazer", metric: "12345" }]);
    await dismissSuggestion(db, a, { id: "cut:Lazer", metric: "-50" });
    assert.deepEqual(await listDismissed(db, a), [{ id: "cut:Lazer", metric: "-50" }]);
    await dismissSuggestion(db, a, { id: "x", metric: null });
    assert.equal((await listDismissed(db, a)).length, 2);
    assert.deepEqual(await listDismissed(db, b), []);
    await assert.rejects(dismissSuggestion(db, a, { id: "", metric: null }));
    await assert.rejects(dismissSuggestion(db, a, { id: "y", metric: "1.5" }));
    await assert.rejects(dismissSuggestion(db, { ...a, role: "reader" }, { id: "z", metric: null }));
    await restoreSuggestions(db, a);
    assert.deepEqual(await listDismissed(db, a), []);
  } finally {
    await db.close();
  }
});

test("readFuture: sinais por categoria, mês anterior e teto", async () => {
  const db = await openDatabase();
  try {
    const user = await member(db, "signals@example.invalid");
    const bank = randomUUID();
    let cat = "";
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',100000,'2026-09-01',$3)",
        [bank, user.familyId, user.userId],
      );
      cat = (await tx.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Lazer'", [user.familyId])).rows[0].id;
      await tx.query(
        "INSERT INTO budgets(household_id,category_id,month,currency,planned_cents) VALUES($1,$2,'2026-11-01','BRL',50000)",
        [user.familyId, cat],
      );
      for (const [date, cents] of [["2026-10-05", 3000], ["2026-11-03", 7000]] as const) {
        const id = randomUUID();
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
           VALUES($1,$2,$3,'expense',$4,'CINEMA','CINEMA',$5,'BRL',$6,$7)`,
          [id, user.familyId, bank, date, -cents, cat, user.userId],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,$9,'BRL',$7,$8)`,
          [randomUUID(), user.familyId, id, bank, randomUUID(), -cents, cents, date, "expense"],
        );
      }
    });
    const { input } = await readFuture(db, user, { today: "2026-11-11" });
    assert.deepEqual(input.signals?.categories, [
      { name: "Lazer", cents: 7000n, prev: 3000n, budget: 50000n },
    ]);
    const round = decodeFutureInput(JSON.parse(JSON.stringify(encodeFutureInput(input))));
    assert.deepEqual(round.signals, input.signals);
  } finally {
    await db.close();
  }
});
