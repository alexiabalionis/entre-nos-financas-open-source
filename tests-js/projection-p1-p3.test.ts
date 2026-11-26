import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { readProjection } from "../src/server/projection.ts";
import { reconcileReceipt } from "../src/domain/projection-cash.ts";
import { assessConfidence } from "../src/domain/projection-confidence.ts";

const TODAY = "2026-11-09";

test("P1: compra pendente e compra aprovada do mesmo ciclo somam na fatura, sem dupla contagem", async () => {
  const db = await openDatabase();
  try {
    await createFamily(db, {
      email: "p1@example.invalid",
      name: "P1",
      password: "SenhaFicticia!2026",
      familyName: "Família P1",
    });
    const userId = (
      await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email='p1@example.invalid'",
      )
    ).rows[0].id;
    const user = (await identity(db, await issueSession(db, userId)))!;
    const run = (sql: string, params: unknown[] = []) =>
      asUser(db, user.userId, (tx) => tx.query(sql, params));

    const checking = randomUUID();
    const card = randomUUID();
    await run(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by,balance_confirmed_cents,balance_confirmed_at) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3,1000000,$4)",
      [checking, user.familyId, user.userId, TODAY],
    );
    await run(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Cartão','Inst','BRL','card',0,'2025-12-31',$3)",
      [card, user.familyId, user.userId],
    );
    await run(
      `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by)
       VALUES($1,$2,$3,25,5,1,'2026-01-01','2026-01-01',$4)`,
      [randomUUID(), user.familyId, card, user.userId],
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
      "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão','BRL','CREDIT',$5)",
      [bankAccount, user.familyId, connection, randomUUID(), card],
    );

    const eventId = randomUUID();
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
         VALUES($1,$2,$3,'card_purchase','2026-11-12','Aprovada','Aprovada',-20000,'BRL',$4)`,
        [eventId, user.familyId, card, user.userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',-20000,'2026-11-12'),($5,$2,$3,NULL,'expense','BRL',20000,'2026-11-12')`,
        [randomUUID(), user.familyId, eventId, card, randomUUID()],
      );
      const insert = `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,status,event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL','POSTED','synthetic',$9,$10,$11)`;
      await tx.query(insert, [
        randomUUID(),
        user.familyId,
        bankAccount,
        card,
        randomUUID(),
        "2026-11-10",
        "LOJA PENDENTE",
        -30000,
        randomUUID(),
        "pending",
        null,
      ]);
      await tx.query(insert, [
        randomUUID(),
        user.familyId,
        bankAccount,
        card,
        randomUUID(),
        "2026-11-12",
        "LOJA APROVADA",
        -20000,
        randomUUID(),
        "recorded",
        eventId,
      ]);
    });

    // Aba Mês: aprovar não muda a fatura (SPEC-FATOS-CARTAO), pendente e
    // aprovada entram, como no Copiloto.
    const month = await readProjection(db, user, { today: TODAY });
    const monthBill = month.flows.find((f) => f.key === `bill:${card}:2026-12`);
    assert.ok(monthBill);
    assert.equal(monthBill.cons.cents, 50000n);

    const report = await readProjection(db, user, {
      today: TODAY,
      copilot: true,
    });
    const billFlow = report.flows.find(
      (f) => f.key === `bill:${card}:2026-12`,
    );
    assert.ok(billFlow);
    assert.equal(billFlow.cons.cents, 50000n);

    const cardOut = report.flows
      .filter((f) => f.direction === "out" && f.key.includes(card))
      .reduce((sum, f) => sum + f.cons.cents, 0n);
    assert.equal(cardOut, 50000n);
  } finally {
    await db.close();
  }
});

test("P3: recebimento previsto para hoje, sem janela e não detectado, não conta no cons", () => {
  const [flow] = reconcileReceipt(
    {
      id: "r",
      cents: 200000n,
      expected: TODAY,
      windowEnd: null,
      detected: false,
    },
    TODAY,
    true,
  );
  assert.equal(flow.cons.cents, 0n);
  assert.equal(flow.cons.date, TODAY);
  assert.equal(flow.nom.cents, 200000n);
  assert.equal(flow.quality, "inconsistent");
  assert.equal(
    flow.explain,
    "Recebimento previsto para hoje; ainda não detectado.",
  );
});

test("P3 fora do Copiloto: recebimento de hoje conta como antes (aba Mês)", () => {
  const [flow] = reconcileReceipt(
    {
      id: "r",
      cents: 200000n,
      expected: TODAY,
      windowEnd: null,
      detected: false,
    },
    TODAY,
  );
  assert.equal(flow.cons.cents, 200000n);
  assert.equal(flow.cons.date, TODAY);
});

test("P3: futuro e recebimento com janela ficam como antes", () => {
  const [future] = reconcileReceipt(
    {
      id: "f",
      cents: 200000n,
      expected: "2026-11-10",
      windowEnd: null,
      detected: false,
    },
    TODAY,
  );
  assert.equal(future.cons.cents, 200000n);
  assert.equal(future.cons.date, "2026-11-10");
  assert.equal(future.quality, "scheduled");

  const [windowed] = reconcileReceipt(
    {
      id: "w",
      cents: 200000n,
      expected: TODAY,
      windowEnd: "2026-11-12",
      detected: false,
    },
    TODAY,
  );
  assert.equal(windowed.nom.date, TODAY);
  assert.equal(windowed.cons.date, "2026-11-12");
  assert.equal(windowed.cons.cents, 200000n);
  assert.equal(windowed.quality, "scheduled");
});

test("P3 ponta a ponta: salário de hoje não detectado não infla o livre", () => {
  const today = "2026-11-05";
  const receipt = reconcileReceipt(
    {
      id: "sal",
      cents: 200000n,
      expected: today,
      windowEnd: null,
      detected: false,
    },
    today,
    true,
  );
  const r = assessConfidence({
    today,
    horizonEnd: "2026-11-30",
    cushion: 0n,
    sConf: 100000n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [
      ...receipt,
      {
        key: "desp",
        direction: "out",
        nom: { date: "2026-11-08", cents: 90000n },
        cons: { date: "2026-11-08", cents: 90000n },
        quality: "planned",
      },
    ],
  });
  assert.ok(r.shown === null || r.shown <= 10000n);
});
