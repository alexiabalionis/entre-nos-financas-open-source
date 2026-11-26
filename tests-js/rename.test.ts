import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import type { Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { UserError } from "../src/server/imports.ts";
import { renameEvent, renameAccount } from "../src/server/rename.ts";
import { loadCardCompetence, readCardEvents } from "../src/server/card-competence.ts";

async function setup(db: Database, email: string) {
  const userId = await createFamily(
    db,
    {
      name: "Pessoa Fictícia",
      familyName: "Teste",
      email,
      password: "senha-ficticia-longa",
    },
    false,
  );
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user: Identity = {
    userId,
    familyId,
    name: "Pessoa Fictícia",
    email,
    role: "owner",
  };
  const card = randomUUID();
  const eventId = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
    [card, familyId, userId],
  );
  await asUser(db, userId, async (tx) => {
    await tx.query(
      `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
       VALUES($1,$2,$3,'expense','2026-11-05','PADARIA X','PADARIA X',-1000,'BRL',$4)`,
      [eventId, familyId, card, userId],
    );
    await tx.query(
      `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
       VALUES($1,$2,$3,$4,NULL,'BRL',-1000,'2026-11-05'),($5,$2,$3,NULL,'expense','BRL',1000,'2026-11-05')`,
      [randomUUID(), familyId, eventId, card, randomUUID()],
    );
  });
  return { user, card, eventId };
}

async function eventRow(db: Database, user: Identity, id: string) {
  return (
    await asUser(db, user.userId, (tx) =>
      tx.query<{ description: string; display_name: string | null }>(
        "SELECT description,display_name FROM economic_events WHERE id=$1",
        [id],
      ),
    )
  ).rows[0];
}

test("renameEvent sets and clears the nickname without touching description", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId } = await setup(db, "rename-a@example.invalid");
    const out = await renameEvent(db, user, { event_id: eventId, name: "  Pão  " });
    assert.equal(out.display_name, "Pão");
    const row = await eventRow(db, user, eventId);
    assert.equal(row.display_name, "Pão");
    assert.equal(row.description, "PADARIA X");
    for (const empty of [null, "   "]) {
      await renameEvent(db, user, { event_id: eventId, name: "Pão" });
      await renameEvent(db, user, { event_id: eventId, name: empty });
      assert.equal((await eventRow(db, user, eventId)).display_name, null);
    }
  } finally {
    await db.close();
  }
});

test("card events expose the nickname as name and keep description", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId } = await setup(db, "rename-b@example.invalid");
    await renameEvent(db, user, { event_id: eventId, name: "Pão" });
    const read = () =>
      asUser(db, user.userId, async (tx) => {
        const ctx = await loadCardCompetence(tx, user.familyId);
        return readCardEvents(tx, ctx, {
          familyId: user.familyId,
          month: "2026-11-01",
          currency: "BRL",
        });
      });
    let [e] = await read();
    assert.equal(e.name, "Pão");
    assert.equal(e.description, "PADARIA X");
    await renameEvent(db, user, { event_id: eventId, name: null });
    [e] = await read();
    assert.equal(e.name, "PADARIA X");
  } finally {
    await db.close();
  }
});

test("renameEvent rejects 121 chars, readers and other families", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId } = await setup(db, "rename-c@example.invalid");
    const other = await setup(db, "rename-d@example.invalid");
    await assert.rejects(
      renameEvent(db, user, { event_id: eventId, name: "a".repeat(121) }),
      (e) => e instanceof UserError && e.message === "O nome pode ter no máximo 120 caracteres.",
    );
    assert.equal((await eventRow(db, user, eventId)).display_name, null);
    await renameEvent(db, user, { event_id: eventId, name: "a".repeat(120) });
    await assert.rejects(
      renameEvent(db, { ...user, role: "reader" }, { event_id: eventId, name: "x" }),
      (e) => e instanceof UserError && e.message === "Seu acesso é somente para leitura.",
    );
    await assert.rejects(
      renameEvent(db, user, { event_id: other.eventId, name: "x" }),
      (e) => e instanceof UserError && e.message === "Movimento indisponível.",
    );
    assert.equal((await eventRow(db, other.user, other.eventId)).display_name, null);
  } finally {
    await db.close();
  }
});

test("renameAccount renames, validates and stays inside the family", async () => {
  const db = await openDatabase();
  try {
    const { user, card } = await setup(db, "rename-e@example.invalid");
    const other = await setup(db, "rename-f@example.invalid");
    const out = await renameAccount(db, user, { account_id: card, name: "  Cartão Roxo " });
    assert.equal(out.name, "Cartão Roxo");
    const name = async () =>
      (await db.query<{ name: string }>("SELECT name FROM accounts WHERE id=$1", [card])).rows[0].name;
    assert.equal(await name(), "Cartão Roxo");
    await assert.rejects(
      renameAccount(db, user, { account_id: card, name: "   " }),
      (e) => e instanceof UserError,
    );
    await assert.rejects(
      renameAccount(db, user, { account_id: card, name: "a".repeat(121) }),
      (e) => e instanceof UserError && e.message === "O nome pode ter no máximo 120 caracteres.",
    );
    await assert.rejects(
      renameAccount(db, user, { account_id: other.card, name: "x" }),
      (e) => e instanceof UserError && e.message === "Conta indisponível.",
    );
    assert.equal(await name(), "Cartão Roxo");
  } finally {
    await db.close();
  }
});
