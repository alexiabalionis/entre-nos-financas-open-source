import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity, type Identity } from "../src/server/auth.ts";
import { readProjection, readUsualAudit } from "../src/server/projection.ts";
import { readRecurringAccounts, saveRecurrenceDecision } from "../src/server/recurrences.ts";

const TODAY = "2026-11-09";

async function family(db: PGlite, tag: string) {
  const email = `rec-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const run = (sql: string, params: unknown[] = []) => asUser(db, user.userId, (tx) => tx.query(sql, params));
  const bank = randomUUID();
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by,balance_confirmed_cents,balance_confirmed_at) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3,900000,$4)",
    [bank, user.familyId, user.userId, TODAY],
  );
  // Transporte já vem nas categorias iniciais da família, como variável.
  const transporte = (
    (await run("SELECT id FROM categories WHERE household_id=$1 AND name='Transporte'", [
      user.familyId,
    ])) as { rows: { id: string }[] }
  ).rows[0].id;
  await run("UPDATE categories SET fixed=false,essential=false WHERE id=$1", [transporte]);
  const spend = (date: string, cents: number, description: string) =>
    asUser(db, user.userId, async (tx) => {
      const eventId = randomUUID();
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
        [eventId, user.familyId, bank, date, description, -cents, transporte, user.userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,'expense','BRL',$7,$8)`,
        [randomUUID(), user.familyId, eventId, bank, randomUUID(), -cents, cents, date],
      );
    });
  for (const date of ["2026-08-04", "2026-09-04", "2026-10-04"]) await spend(date, 140000, "FINANCIAMENTO CARRO");
  // Uber várias vezes por mês: não é conta fixa.
  for (const date of ["2026-09-02", "2026-09-15", "2026-10-03", "2026-10-21"]) await spend(date, 3000, "UBER TRIP");
  return { user, run };
}

const carKey = (flows: { key: string }[], merchant: string) =>
  flows.some((f) => f.key.startsWith(`rec:cash:${merchant}:`));

test("4a: marcar 'sim' numa sugestão não prevê mais nada pelo comportamento; 'não' segue suprimindo a sugestão", async () => {
  const db = await openDatabase();
  try {
    const { user } = await family(db, "carro");
    const list = await readRecurringAccounts(db, user, { today: TODAY });
    assert.equal(list.length, 1, "uber não entra: várias vezes no mês");
    const car = list[0];
    assert.equal(car.cents, "140000");
    assert.equal(car.day, 4);
    assert.equal(car.category, "Transporte");
    assert.equal(car.decision, null);

    const before = await readProjection(db, user, { today: TODAY });
    assert.equal(carKey(before.flows, car.merchant_key), false);

    await saveRecurrenceDecision(db, user, { scope: "cash", merchant_key: car.merchant_key, decision: "confirm" });
    assert.equal((await readRecurringAccounts(db, user, { today: TODAY }))[0].decision, "confirm");
    const month = await readProjection(db, user, { today: TODAY });
    const copilot = await readProjection(db, user, { today: TODAY, copilot: true });
    assert.equal(carKey(month.flows, car.merchant_key), false, "aba Mês não prevê pelo histórico");
    assert.equal(carKey(copilot.flows, car.merchant_key), false, "Copiloto não prevê pelo histórico");
    const audit = await readUsualAudit(db, user, { today: TODAY });
    assert.ok(
      audit.included.some((g) => g.label === "Transporte"),
      "sem série, o carro segue no ritmo do dia a dia",
    );

    await saveRecurrenceDecision(db, user, { scope: "cash", merchant_key: car.merchant_key, decision: "dismiss" });
    assert.equal((await readRecurringAccounts(db, user, { today: TODAY }))[0].decision, "dismiss");
    await assert.rejects(
      saveRecurrenceDecision(db, user, { scope: "cash", merchant_key: car.merchant_key, decision: null }),
    );
  } finally {
    await db.close();
  }
});

test("leitor não marca; cartão de outra família é recusado", async () => {
  const db = await openDatabase();
  try {
    const { user } = await family(db, "regras");
    const reader: Identity = { ...user, role: "reader" };
    await assert.rejects(
      saveRecurrenceDecision(db, reader, { scope: "cash", merchant_key: "X", decision: "confirm" }),
      /leitura/,
    );
    await assert.rejects(
      saveRecurrenceDecision(db, user, { scope: randomUUID(), merchant_key: "X", decision: "confirm" }),
      /Cartão não encontrado/,
    );
  } finally {
    await db.close();
  }
});

