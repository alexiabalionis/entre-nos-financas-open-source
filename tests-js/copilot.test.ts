import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import {
  createFamily,
  issueSession,
  identity,
  type Identity,
} from "../src/server/auth.ts";
import { readCopilot, toCopilotWire } from "../src/server/copilot.ts";
import { readProjection } from "../src/server/projection.ts";
import {
  ensureFirstGoal,
  listGoals,
  savePlan,
} from "../src/server/reserves.ts";
import {
  createGoal,
  readReserves,
  saveGoalLocation,
} from "../src/server/reserve-goal.ts";
import { addMovement } from "../src/server/reserve-movements.ts";
import { UserError } from "../src/server/imports.ts";
import { seedIncomeOccurrence, seedIncomeSeries } from "./income-seed.ts";

const TODAY = "2026-11-09";
const WEEKS = [
  "2026-09-16",
  "2026-09-23",
  "2026-09-30",
  "2026-10-07",
  "2026-10-14",
  "2026-10-21",
  "2026-10-28",
  "2026-11-04",
];

let db: PGlite;
let seq = 0;

type Seed = {
  balance?: boolean;
  incomeDetected?: boolean;
  history?: boolean;
  overdue?: boolean;
  bigSpend?: number;
};

async function family(tag: string, seed: Seed): Promise<Identity> {
  const email = `${tag}-${seq++}@example.invalid`;
  await createFamily(db, {
    email,
    name: tag,
    password: "SenhaFicticia!2026",
    familyName: tag,
  });
  const userId = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [
      email,
    ])
  ).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const run = (sql: string, params: unknown[] = []) =>
    asUser(db, user.userId, (tx) => tx.query(sql, params));
  const bank = randomUUID();
  const opening = seed.balance === false ? null : 0;
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Banco','Inst','BRL','checking',$4,$5,$3)",
    [
      bank,
      user.familyId,
      user.userId,
      opening,
      opening === null ? null : "2025-12-31",
    ],
  );
  if (seed.balance !== false)
    await run(
      "UPDATE accounts SET balance_confirmed_cents=500000,balance_confirmed_at=$2 WHERE id=$1",
      [bank, TODAY],
    );
  const category = randomUUID();
  await run(
    "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Mercado')",
    [category, user.familyId],
  );
  const spend = async (date: string, cents: number) => {
    const eventId = randomUUID();
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
        [
          eventId,
          user.familyId,
          bank,
          date,
          "LOJA " + date,
          -cents,
          category,
          user.userId,
        ],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,'expense','BRL',$7,$8)`,
        [
          randomUUID(),
          user.familyId,
          eventId,
          bank,
          randomUUID(),
          -cents,
          cents,
          date,
        ],
      );
    });
  };
  if (seed.history !== false) for (const date of WEEKS) await spend(date, 1000);
  if (seed.bigSpend) await spend("2026-11-06", seed.bigSpend);
  if (seed.incomeDetected) {
    const rule = await seedIncomeSeries(run, {
      familyId: user.familyId,
      userId: user.userId,
      accountId: bank,
      day: 5,
      cents: 600000,
    });
    const item = randomUUID();
    await run(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,status,created_by)
       VALUES($1,$2,'2026-11-01','Salário','income','BRL',600000,'open',$3)`,
      [item, user.familyId, user.userId],
    );
    await seedIncomeOccurrence(run, {
      familyId: user.familyId,
      recurrenceId: rule,
      itemId: item,
      occurrenceDate: "2026-11-05",
      expectedDate: "2026-11-05",
      state: "detected",
    });
  }
  if (seed.overdue)
    await run(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,status,created_by)
       VALUES($1,$2,'2026-11-01','Luz','expense','BRL',15000,'2026-11-03','open',$3)`,
      [randomUUID(), user.familyId, user.userId],
    );
  return user;
}

before(async () => {
  db = await openDatabase();
});
after(async () => {
  await db?.close();
});

test("renda detectada, histórico e saldo: decide pelo hábito (o que sobra depois do dia a dia)", async () => {
  const user = await family("decide", { incomeDetected: true });
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.action.kind, "decide");
  assert.ok(c.capacity !== null && c.capacity > 0n);
  // Histórico: R$ 10 por semana.
  assert.equal(c.usualWeekly, 1000n);
  const usualSpend = (1000n * BigInt(c.daysLeft)) / 7n;
  const left = (c.capacity as bigint) - usualSpend;
  const room = c.target;
  assert.equal(c.suggestion, ((left < room ? left : room) / 1000n) * 1000n);
  assert.equal(c.goal, null);

  // "Como chegamos nesse valor" fecha com o livre mostrado.
  const b = c.breakdown;
  assert.equal(b.livre, c.livre);
  assert.equal(
    b.start + b.income - b.bills - b.reserve + b.adjust - b.margin - b.reserveOnAccount,
    c.livre,
  );
  // Semanas até o salário cobrem do hoje até a véspera.
  assert.equal(c.weeks[0].from, TODAY);
  assert.equal(c.weeks.at(-1)?.to, c.until);
  const wire = toCopilotWire(c);
  assert.equal(typeof wire.livre, "string");
  assert.equal(typeof wire.margin, "string");
});

test("plano combinado e não separado com data de hoje: separate", async () => {
  const user = await family("separate", { incomeDetected: true });
  await asUser(db, user.userId, (tx) => ensureFirstGoal(tx, { user }));
  const [goal] = await listGoals(db, user);
  const planId = randomUUID();
  await asUser(db, user.userId, (tx) =>
    tx.query(
      `INSERT INTO reserve_plans(id,household_id,goal_id,month,planned_cents,plan_date,created_by)
       VALUES($1,$2,$3,'2026-11-01',10000,$4,$5)`,
      [planId, user.familyId, goal.id, TODAY, user.userId],
    ),
  );
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.action.kind, "separate");
  assert.equal(c.goal?.plan?.remaining, 10000n);
  assert.equal(c.goal?.cycle, "planned");
  assert.equal(c.breakdown.reserve, 10000n, "plano não separado aparece na conta");

  // "Já separei": depósito ligado ao plano zera o que falta e sai do separate.
  await saveGoalLocation(db, user, { goal_id: goal.id, location: "elsewhere", version: goal.version });
  await addMovement(db, user, {
    goal_id: goal.id,
    plan_id: planId,
    kind: "deposit",
    amount: "100,00",
    date: TODAY,
  });
  const separated = await readCopilot(db, user, { today: TODAY });
  assert.equal(separated.goal?.plan?.remaining, 0n);
  assert.equal(separated.goal?.cycle, "done");
  assert.notEqual(separated.action.kind, "separate");
});

test("dois objetivos ativos: o já decidido cede o holofote ao próximo, em ordem de prioridade", async () => {
  const user = await family("duasreservas", { incomeDetected: true });
  await asUser(db, user.userId, (tx) => ensureFirstGoal(tx, { user }));
  const [first] = await listGoals(db, user);
  const { id: secondId } = await createGoal(db, user, {
    name: "Viagem",
    target: "2.000,00",
    deadline_month: null,
  });

  // Com um só pendente, o holofote é ele — mesmo sendo o segundo criado.
  const before = await readCopilot(db, user, { today: TODAY });
  assert.equal(before.goal?.id, first.id);

  // Decidido (ainda que pulando o mês) o primeiro, o segundo assume.
  await savePlan(db, user, { goal_id: first.id, month: TODAY.slice(0, 7), planned: "0,00" });
  const after = await readCopilot(db, user, { today: TODAY });
  assert.equal(after.goal?.id, secondId);
  assert.equal(after.goal?.cycle, "not_planned");
  assert.equal(after.target, 200000n);
  assert.equal(after.action.kind, "decide");
});

test("sem saldo informado: need_data com lacuna de saldo", async () => {
  const user = await family("semsaldo", {
    balance: false,
    incomeDetected: true,
  });
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.action.kind, "need_data");
  if (c.action.kind === "need_data")
    assert.ok(c.action.gap?.key.startsWith("saldo:"));
});

test("conta vencida em aberto: overdue", async () => {
  const user = await family("vencida", { incomeDetected: true, overdue: true });
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.action.kind, "overdue");
  assert.equal(c.overdue[0].label, "Luz");
  assert.equal(c.overdue[0].amount, 15000n);
});

test("categoria muito acima do normal aparece em overspent", async () => {
  const user = await family("acima", { incomeDetected: true, bigSpend: 30000 });
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.overspent[0]?.category, "Mercado");
  assert.ok(c.overspent[0].over >= 2000n);
  const normal = await family("normal", { incomeDetected: true });
  assert.deepEqual(
    (await readCopilot(db, normal, { today: TODAY })).overspent,
    [],
  );
});

test("leitor: não grava plano nem cria objetivo ao listar", async () => {
  const owner = await family("leitor", { incomeDetected: true });
  const reader: Identity = { ...owner, role: "reader" };
  assert.deepEqual(await readReserves(db, reader), []);
  await assert.rejects(
    savePlan(db, reader, {
      goal_id: randomUUID(),
      month: "2026-11",
      planned: "100,00",
    }),
    UserError,
  );
  assert.equal((await readReserves(db, owner)).length, 1);
});

test("saveGoalLocation: versão errada é recusada e a certa grava", async () => {
  const user = await family("local", { incomeDetected: true });
  const [goal] = await readReserves(db, user);
  await assert.rejects(
    saveGoalLocation(db, user, {
      goal_id: goal.id,
      location: "elsewhere",
      version: goal.version + 5,
    }),
    UserError,
  );
  const saved = await saveGoalLocation(db, user, {
    goal_id: goal.id,
    location: "elsewhere",
    version: goal.version,
  });
  assert.equal(saved.version, goal.version + 1);
  assert.equal((await readReserves(db, user))[0].location, "elsewhere");
});

test("pausar e voltar: o plano anterior fica guardado e o livre devolve o valor", async () => {
  const user = await family("pausa", { incomeDetected: true });
  await asUser(db, user.userId, (tx) => ensureFirstGoal(tx, { user }));
  const [goal] = await listGoals(db, user);
  const month = TODAY.slice(0, 7);
  const first = await savePlan(db, user, { goal_id: goal.id, month, planned: "100,00" });
  const before = await readCopilot(db, user, { today: TODAY });
  assert.equal(before.goal?.plan?.previous, null);

  const paused = await savePlan(db, user, {
    goal_id: goal.id,
    month,
    planned: "0,00",
    version_of: first.id,
  });
  const onPause = await readCopilot(db, user, { today: TODAY });
  assert.equal(onPause.goal?.plan?.planned, 0n);
  assert.equal(onPause.goal?.plan?.previous, 10000n);
  assert.equal(onPause.goal?.cycle, "skipped");
  assert.equal(onPause.livre - before.livre, 10000n, "pausar libera o que faltava separar");

  await savePlan(db, user, { goal_id: goal.id, month, planned: "100,00", version_of: paused.id });
  const back = await readCopilot(db, user, { today: TODAY });
  assert.equal(back.goal?.plan?.planned, 10000n);
  assert.equal(back.goal?.plan?.previous, 0n);
  assert.equal(back.livre, before.livre);
});

test("horizonte: Copiloto e Mês vão até a véspera do PRÓXIMO salário", async () => {
  const user = await family("horizonte", { incomeDetected: true });
  const rule = await asUser(db, user.userId, async (tx) => {
    const bank = (
      await tx.query<{ id: string }>("SELECT id FROM accounts WHERE household_id=$1 LIMIT 1", [user.familyId])
    ).rows[0].id;
    return seedIncomeSeries((sql, params) => tx.query(sql, params), {
      familyId: user.familyId,
      userId: user.userId,
      accountId: bank,
      label: "Salário 25",
      matchText: "SALARIO 25",
      day: 25,
      cents: 100000,
    });
  });
  // Próximos salários registrados: 25/11 e 25/12.
  for (const [pay, date] of [
    ["2026-11-01", "2026-11-25"],
    ["2026-12-01", "2026-12-25"],
  ])
    await asUser(db, user.userId, async (tx) => {
      const item = randomUUID();
      await tx.query(
        `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,status,created_by)
         VALUES($1,$2,$3,'Salário extra','income','BRL',100000,'open',$4)`,
        [item, user.familyId, pay, user.userId],
      );
      await seedIncomeOccurrence((sql, params) => tx.query(sql, params), {
        familyId: user.familyId,
        recurrenceId: rule,
        itemId: item,
        occurrenceDate: date,
        expectedDate: date,
        state: "planned",
      });
    });
  const c = await readCopilot(db, user, { today: TODAY });
  assert.equal(c.until, "2026-11-24");
  assert.ok(c.breakdown.lowDay <= "2026-11-24");
  const month = await readProjection(db, user, { today: TODAY });
  assert.equal(month.horizonEnd, "2026-11-24");
});
