import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser, type Database } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import type { Identity } from "../src/server/auth.ts";
import { readProjection } from "../src/server/projection.ts";
import { readAutoCountedChecking } from "../src/server/realized-spend.ts";
import { seedIncomeOccurrence, seedIncomeSeries } from "./income-seed.ts";
import {
  reconcileReserve,
  reserveCushion,
  type ReserveInput,
} from "../src/domain/projection-reserve.ts";

const TODAY = "2026-11-09";
const PURE = { today: TODAY, snapshotDate: TODAY };

function pure(
  planned: bigint,
  extra: Partial<ReserveInput> = {},
  location: "same_account" | "elsewhere" | null = null,
): ReserveInput {
  return {
    goals: [{ id: "g", name: "Meta", status: "active", location }],
    plans: [{ id: "p", goalId: "g", planned, planDate: TODAY }],
    movements: [],
    ...extra,
  };
}
const deposit = (
  cents: bigint,
  o: { planId?: string | null; date?: string; bank?: string | null; voided?: boolean } = {},
) => ({
  id: "m" + cents,
  goalId: "g",
  planId: o.planId === undefined ? "p" : o.planId,
  kind: "deposit" as const,
  cents,
  date: o.date ?? TODAY,
  bankTransactionId: o.bank ?? null,
  voided: o.voided ?? false,
});

test("plano sem depósito vira fluxo do valor inteiro", () => {
  const [flow, ...rest] = reconcileReserve(PURE, pure(15000n));
  assert.equal(rest.length, 0);
  assert.equal(flow.key, "reserve:p");
  assert.equal(flow.nom.cents, 15000n);
  assert.equal(flow.cons.cents, 15000n);
});

test("depósito parcial abate; cancelado não conta; plano zero e plano de objetivo concluído não geram fluxo", () => {
  const partial = reconcileReserve(
    PURE,
    pure(15000n, { movements: [deposit(10000n)] }),
  );
  assert.equal(partial[0].cons.cents, 5000n);
  const voided = reconcileReserve(
    PURE,
    pure(15000n, { movements: [deposit(10000n, { voided: true })] }),
  );
  assert.equal(voided[0].cons.cents, 15000n);
  assert.equal(reconcileReserve(PURE, pure(0n)).length, 0);
  const done = pure(15000n);
  done.goals[0].status = "done";
  assert.equal(reconcileReserve(PURE, done).length, 0);
});

test("colchão: só a mesma conta conta; sem local definido não desconta", () => {
  const moves = { movements: [deposit(10000n)] };
  assert.equal(reserveCushion(pure(15000n, moves, null)), 0n);
  assert.equal(reserveCushion(pure(15000n, moves, "elsewhere")), 0n);
  assert.equal(reserveCushion(pure(15000n, moves, "same_account")), 10000n);
});

test("depósito em outro lugar sem banco: conta só se for a partir do snapshot", () => {
  const after = reconcileReserve(
    PURE,
    pure(0n, { movements: [deposit(15000n, { planId: null })] }, "elsewhere"),
  );
  assert.equal(after.length, 1);
  assert.equal(after[0].key, "resdecl:m15000");
  assert.equal(after[0].nom.cents, 0n);
  assert.equal(after[0].cons.cents, 15000n);
  assert.equal(after[0].quality, "inconsistent");
  const before = reconcileReserve(
    PURE,
    pure(
      0n,
      { movements: [deposit(15000n, { planId: null, date: "2026-11-01" })] },
      "elsewhere",
    ),
  );
  assert.equal(before.length, 0);
  const banked = reconcileReserve(
    PURE,
    pure(
      0n,
      { movements: [deposit(15000n, { planId: null, bank: "tx" })] },
      "elsewhere",
    ),
  );
  assert.equal(banked.length, 0);
});

type Setup = {
  plan?: bigint;
  location?: "same_account" | "elsewhere";
  deposit?: { bank?: boolean };
  weekly?: bigint;
  history?: boolean;
};

async function scenario(db: Database, tag: string, s: Setup) {
  await createFamily(db, {
    email: `${tag}@example.invalid`,
    name: tag,
    password: "SenhaFicticia!2026",
    familyName: "Casa " + tag,
  });
  const userId = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [
      `${tag}@example.invalid`,
    ])
  ).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const run = (sql: string, params: unknown[] = []) =>
    asUser(db, user.userId, (tx) => tx.query(sql, params));
  const checking = randomUUID();
  const connection = randomUUID();
  const bankAccount = randomUUID();
  const goal = randomUUID();
  const plan = randomUUID();
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by,balance_confirmed_cents,balance_confirmed_at) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3,1000000,$4)",
    [checking, user.familyId, user.userId, TODAY],
  );
  await run(
    "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')",
    [user.familyId, user.userId],
  );
  await run(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2026-01-01')",
    [connection, user.familyId, user.userId, randomUUID()],
  );
  await run(
    "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'C','BRL','BANK',$5)",
    [bankAccount, user.familyId, connection, randomUUID(), checking],
  );
  if (s.history)
    for (let week = 1; week <= 8; week++) {
      const day = new Date(Date.UTC(2026, 10, 9 - 7 * week + 2))
        .toISOString()
        .slice(0, 10);
      const event = randomUUID();
      await asUser(db, user.userId, async (tx) => {
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
           VALUES($1,$2,$3,'expense',$4,'Mercado','Mercado',-1000,'BRL',$5)`,
          [event, user.familyId, checking, day, user.userId],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',-1000,$5),($6,$2,$3,NULL,'expense','BRL',1000,$5)`,
          [randomUUID(), user.familyId, event, checking, day, randomUUID()],
        );
      });
    }
  const rule = await seedIncomeSeries(run, {
    familyId: user.familyId,
    userId: user.userId,
    accountId: checking,
    day: 20,
    cents: 600000,
  });
  const incomeItem = randomUUID();
  await run(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,status,created_by)
     VALUES($1,$2,'2026-11-01','Salário','income','BRL',600000,'open',$3)`,
    [incomeItem, user.familyId, user.userId],
  );
  await seedIncomeOccurrence(run, {
    familyId: user.familyId,
    recurrenceId: rule,
    itemId: incomeItem,
    occurrenceDate: "2026-11-20",
    expectedDate: "2026-11-20",
    state: "planned",
  });
  if (s.weekly !== undefined)
    await run(
      "INSERT INTO household_finance_settings(household_id,everyday_weekly_cents,updated_by) VALUES($1,$2,$3)",
      [user.familyId, s.weekly, user.userId],
    );
  if (s.plan !== undefined) {
    await run(
      "INSERT INTO goals(id,household_id,name,target_cents,location,created_by) VALUES($1,$2,'Meta',500000,$3,$4)",
      [goal, user.familyId, s.location ?? null, user.userId],
    );
    await run(
      "INSERT INTO reserve_plans(id,household_id,goal_id,month,planned_cents,plan_date,created_by) VALUES($1,$2,$3,'2026-11-01',$4,$5,$6)",
      [plan, user.familyId, goal, s.plan, TODAY, user.userId],
    );
  }
  if (s.deposit) {
    const line = randomUUID();
    if (s.deposit.bank)
      await run(
        `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,status,analysis)
         VALUES($1,$2,$3,$4,$5,'2026-11-12','PIX RESERVA',-15000,'BRL','PENDING','synthetic',$6,'pending','{"group":"expense"}')`,
        [line, user.familyId, bankAccount, checking, randomUUID(), randomUUID()],
      );
    await run(
      "INSERT INTO reserve_movements(id,household_id,goal_id,plan_id,kind,cents,date,bank_transaction_id,created_by) VALUES($1,$2,$3,$4,'deposit',15000,$5,$6,$7)",
      [
        randomUUID(),
        user.familyId,
        goal,
        plan,
        TODAY,
        s.deposit.bank ? line : null,
        user.userId,
      ],
    );
  }
  return user;
}

async function shown(tag: string, s: Setup): Promise<bigint | null> {
  const db = await openDatabase();
  try {
    const user = await scenario(db, tag, s);
    return (await readProjection(db, user, { today: TODAY, copilot: true })).shown;
  } finally {
    await db.close();
  }
}

test("mesma conta: separar o valor não muda o livre (sai do plano, entra no colchão)", async () => {
  const planOnly = await shown("sa1", {
    history: true,
    plan: 15000n,
    location: "same_account",
  });
  const separated = await shown("sa2", {
    history: true,
    plan: 15000n,
    location: "same_account",
    deposit: {},
  });
  assert.notEqual(planOnly, null);
  assert.equal(separated, planOnly);
});

test("outro lugar com PIX agendado vinculado: o livre cai 150 uma vez só", async () => {
  const none = await shown("el0", { history: true });
  const planOnly = await shown("el1", {
    history: true,
    plan: 15000n,
    location: "elsewhere",
  });
  const withPix = await shown("el2", {
    history: true,
    plan: 15000n,
    location: "elsewhere",
    deposit: { bank: true },
  });
  assert.notEqual(none, null);
  assert.equal(planOnly, none! - 15000n);
  assert.equal(withPix, none! - 15000n);
});

test("gasto declarado sem histórico vira o ritmo de referência; sem nada, o número aparece igual", async () => {
  const db = await openDatabase();
  try {
    const user = await scenario(db, "decl", { weekly: 5000n });
    const report = await readProjection(db, user, { today: TODAY, copilot: true });
    assert.equal(report.copilot?.usualWeekly, 5000n);
    assert.equal(report.copilot?.margin, 2000n);
    assert.notEqual(report.shown, null);
  } finally {
    await db.close();
  }
  const db2 = await openDatabase();
  try {
    const user = await scenario(db2, "nodecl", {});
    const report = await readProjection(db2, user, { today: TODAY, copilot: true });
    assert.equal(report.copilot?.usualWeekly, null);
    assert.notEqual(report.shown, null, "sem histórico não trava mais o número");
  } finally {
    await db2.close();
  }
});

test("readAutoCountedChecking ignora a linha do banco ligada a depósito de reserva", async () => {
  const db = await openDatabase();
  try {
    const user: Identity = await scenario(db, "rs", {
      plan: 15000n,
      location: "elsewhere",
      deposit: { bank: true },
    });
    const rows = await asUser(db, user.userId, (tx) =>
      readAutoCountedChecking(tx, {
        familyId: user.familyId,
        from: "2026-11-01",
        to: "2026-12-01",
      }),
    );
    assert.equal(rows.length, 0);
  } finally {
    await db.close();
  }
});
