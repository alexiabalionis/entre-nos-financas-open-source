import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { readState } from "../src/server/state.ts";
import { readOtherCurrencyCardSpend } from "../src/server/card-competence.ts";

// O aviso de gasto de cartão em outra moeda só vale para despesa real cuja
// competência é o mês da tela; o total em BRL nunca muda.
async function setup(email: string) {
  const db = await openDatabase();
  const userId = await createFamily(db, {
    name: "Teste",
    familyName: "Casa",
    email,
    password: "Sintetica!2026abcd",
  });
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user = { userId, familyId, name: "Teste", email, role: "owner" } as Identity;
  const card = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão USD','Teste','USD','card',$3)",
    [card, familyId, userId],
  );
  const addEvent = (kind: string, date: string, cents: number) =>
    asUser(db, userId, async (tx) => {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
         VALUES($1,$2,$3,$4,$5,$4,$4,$6,'USD',$7)`,
        [id, familyId, card, kind, date, cents, userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'USD',$5,$6),($7,$2,$3,NULL,$8,'USD',$9,$6)`,
        [randomUUID(), familyId, id, card, cents, date, randomUUID(), kind, -cents],
      );
    });
  const spend = () =>
    asUser(db, userId, (tx) =>
      readOtherCurrencyCardSpend(tx, {
        familyId,
        month: "2026-11-01",
        currency: "BRL",
      }),
    );
  return { db, user, addEvent, spend };
}

test("despesa USD antiga fora da competência não gera aviso", async () => {
  const { db, addEvent, spend } = await setup("oc-old@example.invalid");
  try {
    await addEvent("card_purchase", "2026-03-05", -5000);
    assert.deepEqual(await spend(), []);
  } finally {
    await db.close();
  }
});

test("estorno e pagamento de fatura em USD não geram aviso", async () => {
  const { db, addEvent, spend } = await setup("oc-refund@example.invalid");
  try {
    await addEvent("refund", "2026-11-06", 3000);
    await addEvent("card_payment", "2026-11-07", 9000);
    assert.deepEqual(await spend(), []);
  } finally {
    await db.close();
  }
});

test("despesa USD na competência gera aviso e o total em BRL não muda", async () => {
  const { db, user, addEvent, spend } = await setup("oc-in@example.invalid");
  try {
    const read = () =>
      readState(db, user, "2026-11-01", "BRL", undefined, undefined, false);
    const before = (await read()).summary.expense_cents;
    await addEvent("card_purchase", "2026-11-05", -5000);
    assert.deepEqual(await spend(), [
      { currency: "USD", count: 1, amount_cents: "-5000" },
    ]);
    const state = await read();
    assert.equal(state.summary.expense_cents, before);
    assert.ok(
      state.insights.some(
        (i) => i.title === "Gastos de cartão em outra moeda fora do total",
      ),
    );
  } finally {
    await db.close();
  }
});
