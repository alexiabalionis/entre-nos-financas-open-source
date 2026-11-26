import { test } from "node:test";
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
import { readProjection } from "../src/server/projection.ts";
import { saveCopilotMargin } from "../src/server/reserves.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { defaultMargin, weeklyRate } from "../src/domain/everyday.ts";
import { seedIncomeOccurrence, seedIncomeSeries } from "./income-seed.ts";

test("weeklyRate: menos de 4 semanas não estima", () => {
  assert.equal(weeklyRate([]), null);
  assert.equal(weeklyRate([200n, 220n, 190n]), null);
  assert.equal(weeklyRate([0n, 0n, 0n, 0n, 0n, 200n, 220n, 190n]), null);
});

test("weeklyRate: mediana e média sobre 4 semanas", () => {
  assert.deepEqual(weeklyRate([200n, 220n, 190n, 210n]), {
    nom: 205n,
    cons: 205n,
  });
});

test("weeklyRate: semana atípica pesa no conservador, não no nominal", () => {
  assert.deepEqual(
    weeklyRate([180n, 200n, 210n, 190n, 350n, 200n, 220n, 205n]),
    { nom: 202n, cons: 219n },
  );
});

test("weeklyRate: conta a partir da primeira semana com gasto", () => {
  assert.deepEqual(weeklyRate([0n, 0n, 200n, 220n, 190n, 210n, 205n, 215n]), {
    nom: 207n,
    cons: 207n,
  });
});

test("defaultMargin: meia semana típica, para baixo em R$ 10; sem ritmo, zero", () => {
  assert.equal(defaultMargin(180000n), 90000n);
  assert.equal(defaultMargin(7000n), 3000n);
  assert.equal(defaultMargin(null), 0n);
});

const TODAY = "2026-11-09";
const WEEK_DAYS = [
  "2026-09-16",
  "2026-09-23",
  "2026-09-30",
  "2026-10-07",
  "2026-10-14",
  "2026-10-21",
  "2026-10-28",
  "2026-11-04",
];

async function setup(db: PGlite, tag: string) {
  const email = `everyday-${tag}@example.invalid`;
  await createFamily(db, {
    email,
    name: `Família ${tag}`,
    password: "SenhaFicticia!2026",
    familyName: `Família ${tag}`,
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
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by,balance_confirmed_cents,balance_confirmed_at) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3,500000,$4)",
    [bank, user.familyId, user.userId, TODAY],
  );
  const rule = await seedIncomeSeries(run, {
    familyId: user.familyId,
    userId: user.userId,
    accountId: bank,
    day: 20,
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
    occurrenceDate: "2026-11-20",
    expectedDate: "2026-11-20",
    state: "planned",
  });
  return { user, bank, run };
}

async function category(
  f: { user: Identity; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  name: string,
  fixed = false,
): Promise<string> {
  const id = randomUUID();
  await f.run(
    "INSERT INTO categories(id,household_id,name,fixed) VALUES($1,$2,$3,$4)",
    [id, f.user.familyId, name, fixed],
  );
  return id;
}

async function spendWeekly(
  db: PGlite,
  f: { user: Identity; bank: string },
  p: { cents: number; categoryId?: string; tag?: string; description?: string },
) {
  for (const [i, date] of WEEK_DAYS.entries()) {
    const eventId = randomUUID();
    const description =
      p.description ?? `LOJA${"ABCDEFGH"[i]} ${p.tag ?? "SEMANAL"}`;
    await asUser(db, f.user.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
        [
          eventId,
          f.user.familyId,
          f.bank,
          date,
          description,
          -p.cents,
          p.categoryId ?? null,
          f.user.userId,
        ],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$7,$8),($5,$2,$3,NULL,'expense','BRL',$6,$8)`,
        [
          randomUUID(),
          f.user.familyId,
          eventId,
          f.bank,
          randomUUID(),
          p.cents,
          -p.cents,
          date,
        ],
      );
    });
  }
}

test("Copiloto: mesma base do Mês; o dia a dia não é descontado, só vira referência e margem", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "base");
    await spendWeekly(db, f, { cents: 7000 });
    const month = await readProjection(db, f.user, { today: TODAY });
    const copilot = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(copilot.flows.some((x) => x.key.startsWith("day:")), false);
    assert.equal(copilot.copilot?.usualWeekly, 7000n);
    // Margem padrão: meia semana típica (R$ 35 -> R$ 30).
    assert.equal(copilot.copilot?.margin, 3000n);
    assert.equal(copilot.copilot?.marginChosen, false);
    // Mesma base: o ponto mais baixo é o mesmo saldo nas duas telas.
    assert.equal(copilot.low.cons.cents, month.low.cons.cents);
    assert.equal(copilot.shown, (month.shown as bigint) - 3000n);
    assert.equal(month.copilot, null);
  } finally {
    await db.close();
  }
});

// Série de despesa do mês, para os testes da 4a: devolve o item de novembro.
async function expenseSeries(
  db: PGlite,
  f: { user: Identity; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  p: { label: string; categoryId: string; matchText: string | null },
): Promise<string> {
  await createRecurrence(db, f.user, {
    purpose: "expense",
    label: p.label,
    category_id: p.categoryId,
    expected_cents: 10000,
    frequency: "month",
    start_date: "2026-11-20",
    match_text: p.matchText,
    today: TODAY,
  });
  const rows = (await f.run(
    "SELECT id FROM monthly_items WHERE household_id=$1 AND label=$2 AND month='2026-11-01'",
    [f.user.familyId, p.label],
  )) as { rows: { id: string }[] };
  return rows.rows[0].id;
}

test("4a: ritmo de sempre: conta paga sem lançamento conciliado não tira a categoria; só o conciliado sai", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "fixas");
    const mercado = await category(f, "Mercado");
    const aluguel = await category(f, "Aluguel", true);
    const escola = await category(f, "Escola");
    await spendWeekly(db, f, { cents: 7000, categoryId: mercado, tag: "MERCADO" });
    await spendWeekly(db, f, { cents: 50000, categoryId: aluguel, tag: "ALUGUEL" });
    await spendWeekly(db, f, { cents: 20000, categoryId: escola, tag: "ESCOLA" });
    // Conta da escola paga neste mês, sem lançamento ligado: não absorve nada.
    await f.run(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,paid_cents,category_id,status,created_by)
       VALUES($1,$2,'2026-11-01','Escola','expense','BRL',20000,20000,$3,'done',$4)`,
      [randomUUID(), f.user.familyId, escola, f.user.userId],
    );
    const report = await readProjection(db, f.user, { today: TODAY, copilot: true });
    // 70 + 500 + 200 por semana.
    assert.equal(report.copilot?.usualWeekly, 77000n);
  } finally {
    await db.close();
  }
});

// Conta avulsa de novembro; devolve o id. Sem valor pago, em aberto.
async function plannedItem(
  f: { user: Identity; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  p: { categoryId: string; cents: number; label?: string; eventId?: string },
): Promise<string> {
  const id = randomUUID();
  await f.run(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,status,event_id,created_by)
     VALUES($1,$2,'2026-11-01',$3,'expense','BRL',$4,$5,'2026-11-12','open',$6,$7)`,
    [id, f.user.familyId, p.label ?? "Conta avulsa", p.cents, p.categoryId, p.eventId ?? null, f.user.userId],
  );
  return id;
}

async function oneEvent(
  db: PGlite,
  f: { user: Identity; bank: string },
  p: { categoryId: string; cents: number; date: string; description: string },
): Promise<string> {
  const eventId = randomUUID();
  await asUser(db, f.user.userId, async (tx) => {
    await tx.query(
      `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
       VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
      [eventId, f.user.familyId, f.bank, p.date, p.description, -p.cents, p.categoryId, f.user.userId],
    );
    await tx.query(
      `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
       VALUES($1,$2,$3,$4,NULL,'BRL',$7,$8),($5,$2,$3,NULL,'expense','BRL',$6,$8)`,
      [randomUUID(), f.user.familyId, eventId, f.bank, randomUUID(), p.cents, -p.cents, p.date],
    );
  });
  return eventId;
}

const audit = async (db: PGlite, f: { user: Identity }) =>
  (await import("../src/server/projection.ts")).readUsualAudit(db, f.user, { today: TODAY });

test("4a: item de Mercado planejado não tira as outras compras de Mercado do ritmo", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "mercado-item");
    const mercado = await category(f, "Mercado");
    await spendWeekly(db, f, { cents: 7000, categoryId: mercado, tag: "MERCADO" });
    await plannedItem(f, { categoryId: mercado, cents: 10000, label: "Compra grande" });
    const a = await audit(db, f);
    // Nenhuma compra de R$70 chega perto de R$100 (±20%): tudo conta.
    assert.equal(a.excluded.length, 0);
    assert.equal(a.usual_weekly_cents, "7000");
  } finally {
    await db.close();
  }
});

test("4a: compra de R$98 no mês do item de R$100 sai como pagamento provável, só ela", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "provavel");
    const mercado = await category(f, "Mercado");
    await spendWeekly(db, f, { cents: 7000, categoryId: mercado, tag: "MERCADO" });
    await plannedItem(f, { categoryId: mercado, cents: 10000 });
    await oneEvent(db, f, { categoryId: mercado, cents: 9800, date: "2026-11-05", description: "MERCADO GRANDE" });
    const a = await audit(db, f);
    assert.deepEqual(a.excluded.map((g) => [g.excluded, g.count, g.total_cents]), [["bill", 1, "9800"]]);
    // As 8 compras de R$70 seguem no ritmo.
    assert.equal(a.included.find((g) => g.label === "Mercado")?.count, 8);
  } finally {
    await db.close();
  }
});

test("4a: dois eventos parecidos para uma conta: só um sai", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "dois");
    const mercado = await category(f, "Mercado");
    await plannedItem(f, { categoryId: mercado, cents: 10000 });
    await oneEvent(db, f, { categoryId: mercado, cents: 9800, date: "2026-11-03", description: "MERCADO A" });
    await oneEvent(db, f, { categoryId: mercado, cents: 10100, date: "2026-11-04", description: "MERCADO B" });
    const a = await audit(db, f);
    const out = a.excluded.filter((g) => g.excluded === "bill");
    assert.equal(out.reduce((s, g) => s + g.count, 0), 1);
    assert.equal(out[0].total_cents, "10100", "vence o valor mais próximo");
    assert.equal(a.included.reduce((s, g) => s + g.count, 0), 1);
  } finally {
    await db.close();
  }
});

test("4a: evento conciliado a item avulso sai, mesmo com valor distante", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "avulso");
    const mercado = await category(f, "Mercado");
    const event = await oneEvent(db, f, { categoryId: mercado, cents: 50000, date: "2026-11-03", description: "REFORMA" });
    await plannedItem(f, { categoryId: mercado, cents: 10000, eventId: event });
    await oneEvent(db, f, { categoryId: mercado, cents: 3000, date: "2026-11-04", description: "PADARIA" });
    const a = await audit(db, f);
    assert.deepEqual(a.excluded.map((g) => [g.excluded, g.total_cents]), [["bill", "50000"]]);
    assert.equal(a.included[0].total_cents, "3000");
  } finally {
    await db.close();
  }
});

test("4a: item pago (sem restante) não absorve nenhum gasto", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "pago");
    const mercado = await category(f, "Mercado");
    await f.run(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,paid_cents,category_id,status,created_by)
       VALUES($1,$2,'2026-11-01','Paga','expense','BRL',10000,10000,$3,'open',$4)`,
      [randomUUID(), f.user.familyId, mercado, f.user.userId],
    );
    await oneEvent(db, f, { categoryId: mercado, cents: 10000, date: "2026-11-03", description: "MERCADO" });
    const a = await audit(db, f);
    assert.equal(a.excluded.length, 0);
    assert.equal(a.included[0].count, 1);
  } finally {
    await db.close();
  }
});

test("4a: ritmo de sempre: gasto de uma série ainda não conciliada não conta, pelo par cartão/dinheiro + texto", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "par");
    const mercado = await category(f, "Mercado");
    const streaming = await category(f, "Streaming");
    await spendWeekly(db, f, { cents: 7000, categoryId: mercado, tag: "MERCADO" });
    await spendWeekly(db, f, { cents: 4000, categoryId: streaming, description: "NETFLIX" });
    const before = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(before.copilot?.usualWeekly, 11000n, "sem série, o Netflix conta");
    await expenseSeries(db, f, { label: "Netflix", categoryId: streaming, matchText: "NETFLIX" });
    const after = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(after.copilot?.usualWeekly, 7000n, "com série, não conta nem em dobro");
  } finally {
    await db.close();
  }
});

test("4a: ritmo de sempre: a transação conciliada a uma ocorrência de série sai como fixa; o resto da categoria volta ao ritmo", async () => {
  const { readUsualAudit } = await import("../src/server/projection.ts");
  const db = await openDatabase();
  try {
    const f = await setup(db, "conciliado");
    const saude = await category(f, "Saude");
    await spendWeekly(db, f, { cents: 30000, categoryId: saude, description: "PLANO SAUDE" });
    const item = await expenseSeries(db, f, { label: "Plano", categoryId: saude, matchText: null });
    const event = (
      (await f.run(
        "SELECT id FROM economic_events WHERE household_id=$1 ORDER BY transaction_date LIMIT 1",
        [f.user.familyId],
      )) as { rows: { id: string }[] }
    ).rows[0].id;
    await f.run("UPDATE monthly_items SET event_id=$1 WHERE id=$2", [event, item]);
    const audit = await readUsualAudit(db, f.user, { today: TODAY });
    const fixed = audit.excluded.find((g) => g.excluded === "fixed");
    assert.equal(fixed?.count, 1);
    // As outras 7 não saem mais pela categoria: voltam ao ritmo.
    assert.equal(audit.excluded.some((g) => g.excluded === "bill"), false);
    assert.equal(audit.included.find((g) => g.label === "Saude")?.count, 7);
  } finally {
    await db.close();
  }
});

test("sem histórico: o número aparece, sem ritmo e sem margem padrão", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "vazio");
    const report = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.notEqual(report.state, "INDETERMINADO");
    assert.equal(report.copilot?.usualWeekly, null);
    assert.equal(report.copilot?.margin, 0n);
    assert.equal(report.shown, 500000n);
  } finally {
    await db.close();
  }
});

test("margem escolhida vale no lugar do padrão; null volta ao padrão", async () => {
  const db = await openDatabase();
  try {
    const f = await setup(db, "margem");
    await spendWeekly(db, f, { cents: 7000 });
    await saveCopilotMargin(db, f.user, { amount: "200,00" });
    const chosen = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(chosen.copilot?.margin, 20000n);
    assert.equal(chosen.copilot?.marginChosen, true);
    assert.equal(chosen.shown, 500000n - 20000n);
    await saveCopilotMargin(db, f.user, { amount: "0,00" });
    const none = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(none.copilot?.margin, 0n);
    await saveCopilotMargin(db, f.user, { amount: null });
    const back = await readProjection(db, f.user, { today: TODAY, copilot: true });
    assert.equal(back.copilot?.margin, 3000n);
    assert.equal(back.copilot?.marginChosen, false);
    // A aba Mês não muda com a margem do Copiloto.
    const month = await readProjection(db, f.user, { today: TODAY });
    assert.equal(month.shown, 500000n);
  } finally {
    await db.close();
  }
});

test("raio-x: mostra o que entra, o que sai e simula sem o gasto sem categoria", async () => {
  const { readUsualAudit } = await import("../src/server/projection.ts");
  const db = await openDatabase();
  try {
    const f = await setup(db, "raiox");
    const mercado = await category(f, "Mercado");
    const aluguel = await category(f, "Aluguel");
    await spendWeekly(db, f, { cents: 7000, categoryId: mercado, tag: "MERCADO" });
    await spendWeekly(db, f, { cents: 50000, categoryId: aluguel, description: "ALUGUEL CASA" });
    await expenseSeries(db, f, { label: "Aluguel", categoryId: aluguel, matchText: "ALUGUEL CASA" });
    await spendWeekly(db, f, { cents: 30000, tag: "PIX FULANO" });
    const audit = await readUsualAudit(db, f.user, { today: TODAY });
    // Sem categoria entra no ritmo: 70 + 300 por semana.
    assert.equal(audit.usual_weekly_cents, "37000");
    assert.equal(audit.simulated.without_uncategorized_cents, "7000");
    assert.equal(audit.simulated.without_any_exclusion_cents, "87000");
    assert.equal(audit.excluded[0].label, "Aluguel");
    assert.equal(audit.excluded[0].excluded, "recurring");
    assert.equal(audit.included.find((g) => g.label === "Mercado")?.weekly_cents, "7000");
    assert.ok(audit.included.some((g) => g.label.startsWith("Sem categoria:")));
  } finally {
    await db.close();
  }
});
