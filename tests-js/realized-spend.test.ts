import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { readRealizedSpend } from "../src/server/realized-spend.ts";

test("gasto realizado: evento + cartão pendente + PIX pendente; ignora o resto e respeita a janela", async () => {
  const db = await openDatabase();
  try {
    await createFamily(db, {
      email: "realized@example.invalid",
      name: "Realizado",
      password: "SenhaFicticia!2026",
      familyName: "Família realizado",
    });
    const userId = (
      await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email='realized@example.invalid'",
      )
    ).rows[0].id;
    const user = (await identity(db, await issueSession(db, userId)))!;
    const run = (sql: string, params: unknown[] = []) =>
      asUser(db, user.userId, (tx) => tx.query(sql, params));

    const checking = randomUUID();
    const card = randomUUID();
    for (const [id, name, kind] of [
      [checking, "Corrente", "checking"],
      [card, "Cartão", "card"],
    ]) {
      await run(
        "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Inst','BRL',$4,$5)",
        [id, user.familyId, name, kind, user.userId],
      );
    }
    await run(
      "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')",
      [user.familyId, user.userId],
    );
    const connection = randomUUID();
    await run(
      "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2026-01-01')",
      [connection, user.familyId, user.userId, randomUUID()],
    );
    const bankOf = new Map<string, string>();
    for (const local of [checking, card]) {
      const bankId = randomUUID();
      bankOf.set(local, bankId);
      await run(
        "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'C','BRL','BANK',$5)",
        [bankId, user.familyId, connection, randomUUID(), local],
      );
    }

    const eventId = randomUUID();
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
         VALUES($1,$2,$3,'expense','2026-11-03','MERCADO CENTRAL','MERCADO CENTRAL',-5000,'BRL',$4)`,
        [eventId, user.familyId, checking, user.userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',-5000,'2026-11-03'),($5,$2,$3,NULL,'expense','BRL',5000,'2026-11-03')`,
        [randomUUID(), user.familyId, eventId, checking, randomUUID()],
      );
    });

    type Bt = {
      local: string;
      date: string;
      description: string;
      cents: number;
      status?: string;
      group?: string;
      op?: string;
      changed?: boolean;
      missing?: boolean;
      eventId?: string;
    };
    const bt = (b: Bt) =>
      run(
        `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,operation_type,payload_hash,last_seen_run,status,event_id,analysis,changed,missing)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL','POSTED',$9,'synthetic',$10,$11,$12,$13::jsonb,$14,$15)`,
        [
          randomUUID(),
          user.familyId,
          bankOf.get(b.local),
          b.local,
          randomUUID(),
          b.date,
          b.description,
          b.cents,
          b.op ?? "",
          randomUUID(),
          b.status ?? "pending",
          b.eventId ?? null,
          JSON.stringify(b.group ? { group: b.group } : {}),
          b.changed ?? false,
          b.missing ?? false,
        ],
      );

    await bt({
      local: card,
      date: "2026-11-05",
      description: "LOJA PENDENTE",
      cents: -12000,
    });
    await bt({
      local: checking,
      date: "2026-11-06",
      description: "PIX ENVIADO FULANO",
      cents: -3000,
      op: "PIX",
    });

    await bt({
      local: card,
      date: "2026-11-05",
      description: "LOJA IGNORADA",
      cents: -100,
      status: "ignored",
    });
    for (const group of ["duplicate", "history", "transfer"]) {
      await bt({
        local: card,
        date: "2026-11-05",
        description: `LOJA ${group}`,
        cents: -100,
        group,
      });
      await bt({
        local: checking,
        date: "2026-11-06",
        description: `PIX ${group}`,
        cents: -100,
        op: "PIX",
        group,
      });
    }
    await bt({
      local: card,
      date: "2026-11-07",
      description: "PAGAMENTO FATURA CARTAO",
      cents: -90000,
    });
    await bt({
      local: card,
      date: "2026-11-05",
      description: "LOJA ALTERADA",
      cents: -100,
      changed: true,
    });
    await bt({
      local: card,
      date: "2026-11-05",
      description: "LOJA SUMIDA",
      cents: -100,
      missing: true,
    });
    await bt({
      local: checking,
      date: "2026-11-03",
      description: "MERCADO CENTRAL",
      cents: -5000,
      status: "linked",
      eventId,
    });
    await bt({
      local: checking,
      date: "2026-10-31",
      description: "PIX ANTES",
      cents: -100,
      op: "PIX",
    });
    await bt({
      local: checking,
      date: "2026-12-01",
      description: "PIX DEPOIS",
      cents: -100,
      op: "PIX",
    });
    await bt({
      local: checking,
      date: "2026-11-08",
      description: "PIX RECEBIDO",
      cents: 4000,
      op: "PIX",
    });

    const rows = await asUser(db, user.userId, (tx) =>
      readRealizedSpend(tx, {
        familyId: user.familyId,
        from: "2026-11-01",
        to: "2026-12-01",
      }),
    );
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(sorted.length, 3);
    assert.deepEqual(
      sorted.map((r) => [r.date, r.cents, r.scope, r.source]),
      [
        ["2026-11-03", 5000n, "cash", "event"],
        ["2026-11-05", 12000n, card, "pending"],
        ["2026-11-06", 3000n, "cash", "pending"],
      ],
    );
    assert.equal(sorted[0].categoryName, null);
    assert.equal(typeof sorted[1].categoryName, "string");
    assert.ok(sorted.every((r) => r.merchant.length > 0));
  } finally {
    await db.close();
  }
});
