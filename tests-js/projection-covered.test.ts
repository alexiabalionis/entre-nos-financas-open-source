import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { readProjection } from "../src/server/projection.ts";

// Item pago cujo lançamento do banco ainda está PENDING não baixou o saldo:
// o fluxo item:<id>:paid precisa existir. Com POSTED o saldo já refletiu.
const TODAY = "2026-11-09";

test("item pago: lançamento PENDING mantém item:<id>:paid; POSTED o remove", async () => {
  const db = await openDatabase();
  try {
    await createFamily(db, {
      email: "covered@example.invalid",
      name: "Cobertura",
      password: "SenhaFicticia!2026",
      familyName: "Família cobertura",
    });
    const userId = (
      await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email='covered@example.invalid'",
      )
    ).rows[0].id;
    const user = (await identity(db, await issueSession(db, userId)))!;
    const run = (sql: string, params: unknown[] = []) =>
      asUser(db, user.userId, (tx) => tx.query(sql, params));

    const checking = randomUUID();
    await run(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by,balance_confirmed_cents,balance_confirmed_at) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3,1000000,$4)",
      [checking, user.familyId, user.userId, TODAY],
    );
    await run(
      "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')",
      [user.familyId, user.userId],
    );
    const connection = randomUUID();
    const bankAccount = randomUUID();
    await run(
      "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2026-01-01')",
      [connection, user.familyId, user.userId, randomUUID()],
    );
    await run(
      "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'C','BRL','BANK',$5)",
      [bankAccount, user.familyId, connection, randomUUID(), checking],
    );

    // Cria evento + item pago + lançamento do banco ligado com o status dado.
    async function paidItem(providerStatus: string) {
      const eventId = randomUUID();
      const itemId = randomUUID();
      await asUser(db, user.userId, async (tx) => {
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
           VALUES($1,$2,$3,'expense','2026-11-09','Pago','Pago',-10000,'BRL',$4)`,
          [eventId, user.familyId, checking, user.userId],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',-10000,'2026-11-09'),($5,$2,$3,NULL,'expense','BRL',10000,'2026-11-09')`,
          [randomUUID(), user.familyId, eventId, checking, randomUUID()],
        );
        await tx.query(
          `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,paid_cents,paid_date,due_date,status,event_id,created_by)
           VALUES($1,$2,'2026-11-01',$3,'expense','BRL',10000,10000,'2026-11-09','2026-11-09','done',$4,$5)`,
          [itemId, user.familyId, "Item " + providerStatus, eventId, user.userId],
        );
        await tx.query(
          // Data futura: só um PENDING agendado segue "não coberto"; com data
          // passada ele já conta como confirmado (bank-settled.ts).
          `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,status,event_id)
           VALUES($1,$2,$3,$4,$5,'2099-11-09','PAGO',-10000,'BRL',$6,'synthetic',$7,'linked',$8)`,
          [
            randomUUID(),
            user.familyId,
            bankAccount,
            checking,
            randomUUID(),
            providerStatus,
            randomUUID(),
            eventId,
          ],
        );
      });
      return itemId;
    }

    const pendingItem = await paidItem("PENDING");
    const postedItem = await paidItem("POSTED");
    const keys = (await readProjection(db, user, { today: TODAY })).flows.map(
      (f) => f.key,
    );
    assert.ok(keys.includes(`item:${pendingItem}:paid`));
    assert.ok(!keys.includes(`item:${postedItem}:paid`));
  } finally {
    await db.close();
  }
});
