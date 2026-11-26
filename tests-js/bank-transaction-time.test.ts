import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import {
  PluggyReader,
  normalizeObservation,
  type RemoteAccount,
} from "../src/server/pluggy.ts";
import {
  saveBankCredentials,
  connectBank,
  readBanks,
  mapBankAccount,
  syncBank,
  observationHash,
} from "../src/server/banks.ts";
import { createManualEvent } from "../src/server/manual.ts";

process.env.BANK_CONNECTIONS_KEY = randomBytes(32).toString("base64");
const credentials = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret-private",
};

test("normalizeObservation keeps transaction_date and adds the full ISO time", () => {
  const account = {
    id: randomUUID(),
    itemId: randomUUID(),
    type: "BANK",
    name: "Conta",
    currencyCode: "BRL",
  } as RemoteAccount;
  const raw = {
    id: "t1",
    accountId: account.id,
    description: "Pix",
    amount: "10.00",
    date: "2026-10-05T22:30:00-03:00",
    type: "DEBIT",
    status: "POSTED",
  };
  const row = normalizeObservation(raw, account);
  assert.equal(row.transaction_at, raw.date);
  assert.equal(row.transaction_date, "2026-10-05");
  assert.equal(
    normalizeObservation({ ...raw, date: "2026-10-05xx" }, account)
      .transaction_at,
    null,
  );
});

test("transaction_at stays out of the observation hash", () => {
  const account = {
    id: randomUUID(),
    itemId: randomUUID(),
    type: "BANK",
    name: "Conta",
    currencyCode: "BRL",
  } as RemoteAccount;
  const row = normalizeObservation(
    {
      id: "t1",
      accountId: account.id,
      description: "Pix",
      amount: "10.00",
      date: "2026-10-05T22:30:00-03:00",
      type: "DEBIT",
      status: "POSTED",
    },
    account,
  );
  const { transaction_at: removed, ...legacy } = row;
  void removed;
  assert.equal(observationHash(row), observationHash(legacy as typeof row));
  assert.equal(
    observationHash(row),
    observationHash({ ...row, transaction_at: "2026-10-05T23:59:00Z" }),
  );
});

test("sync stores the time, COALESCE preserves it and a saved transaction is not flagged as changed", async () => {
  const db = await openDatabase();
  try {
    const userId = await createFamily(db, {
      name: "Titular fictício",
      familyName: "Família de teste",
      email: "bank-time@example.invalid",
      password: "SenhaFicticia!2026",
    });
    const familyId = (
      await db.query<{ household_id: string }>(
        "SELECT household_id FROM members WHERE user_id=$1",
        [userId],
      )
    ).rows[0].household_id;
    const user = {
      userId,
      familyId,
      name: "Titular fictício",
      email: "bank-time@example.invalid",
      role: "owner",
    } as Identity;
    const local = randomUUID();
    await asUser(db, userId, (tx) =>
      tx.query(
        "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Conta A','Teste','BRL','checking',$3)",
        [local, familyId, userId],
      ),
    );
    const item = randomUUID(),
      remote = randomUUID();
    let rows: Record<string, unknown>[] = [];
    const factory = () =>
      new PluggyReader(credentials, async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/auth")
          return Response.json({ apiKey: "test-only-token" });
        if (url.pathname.startsWith("/items/"))
          return Response.json({
            id: item,
            status: "UPDATED",
            lastUpdatedAt: "2026-10-20T12:00:00Z",
            connector: { name: "MeuPluggy" },
          });
        if (url.pathname === "/accounts")
          return Response.json({
            total: 1,
            results: [
              {
                id: remote,
                itemId: item,
                type: "BANK",
                name: "Banco A",
                balance: 1,
                currencyCode: "BRL",
              },
            ],
          });
        return Response.json({ results: rows, next: null });
      });
    const row = (date: string) => ({
      id: "tx-1",
      accountId: remote,
      date,
      description: "Movimento",
      amount: -10.01,
      type: "DEBIT",
      status: "POSTED",
      currencyCode: "BRL",
      providerId: "provider-1",
    });
    await saveBankCredentials(
      db,
      user,
      { ...credentials, consent: true },
      factory,
    );
    const connection = await connectBank(
      db,
      user,
      {
        item_id: item,
        label: "Banco",
        start_date: "2026-10-01",
        consent: true,
      },
      factory,
    );
    const account = (await readBanks(db, user)).accounts[0];
    await mapBankAccount(db, user, { id: account.id, account_id: local });
    const read = async () => {
      await db.query(
        "UPDATE bank_connections SET last_attempt_at=NULL,last_read_at=NULL WHERE id=$1",
        [connection.id],
      );
      await syncBank(db, user, { id: connection.id, force: true }, factory);
    };
    const stored = async () =>
      (
        await db.query<{
          at: string | null;
          day: string;
          changed: boolean;
          version: number;
        }>(
          "SELECT to_char(transaction_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS at,transaction_date::text AS day,changed,version FROM bank_transactions WHERE remote_id='tx-1'",
        )
      ).rows[0];

    rows = [row("2026-10-05")];
    await read();
    const first = await stored();
    const category = (
      await asUser(db, userId, (tx) =>
        tx.query<{ id: string }>(
          "SELECT id FROM categories WHERE household_id=$1 LIMIT 1",
          [familyId],
        ),
      )
    ).rows[0].id;
    const event = await createManualEvent(db, user, {
      account_id: local,
      date: "2026-10-05",
      description: "Movimento",
      amount: "-10,01",
      kind: "expense",
      category_id: category,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    });
    await db.query(
      "UPDATE bank_transactions SET status='recorded',event_id=$1 WHERE remote_id='tx-1'",
      [event],
    );

    rows = [row("2026-10-05T22:30:00-03:00")];
    await read();
    const withTime = await stored();
    assert.equal(
      withTime.day,
      first.day,
      "transaction_date of saved row is unchanged",
    );
    assert.equal(
      withTime.changed,
      false,
      "adding the time is not a bank change",
    );
    assert.equal(withTime.version, first.version);
    assert.equal(withTime.at, "2026-10-06 01:30");

    rows = [{ ...row("2026-10-05T22:30:00-03:00"), date: "2026-10-05" }];
    await read();
    assert.equal(
      (await stored()).at,
      withTime.at,
      "a read without time keeps the stored time",
    );

    rows = [row("2026-10-05T23:10:00-03:00")];
    await read();
    const updated = await stored();
    assert.equal(updated.at, "2026-10-06 02:10");
    assert.equal(updated.day, first.day);
  } finally {
    await db.close();
  }
});
