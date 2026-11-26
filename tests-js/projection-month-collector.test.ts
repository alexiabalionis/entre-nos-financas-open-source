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
import {
  readProjection,
  readProjectionMonth,
  toProjectionWire,
} from "../src/server/projection.ts";
import { startCentsAt } from "../src/domain/projection-month.ts";
import { seedIncomeOccurrence, seedIncomeSeries } from "./income-seed.ts";

// Projeção por mês: banco PGlite em memória, "hoje" fixado em 2026-11-09.
const TODAY = "2026-11-09";

let db: PGlite;
let a: Identity;

async function run(sql: string, params: unknown[] = []) {
  return asUser(db, a.userId, (tx) => tx.query(sql, params));
}

before(async () => {
  db = await openDatabase();
  await createFamily(db, {
    email: "mes-a@example.invalid",
    name: "Família mês A",
    password: "SenhaFicticia!2026",
    familyName: "Família mês A",
  });
  const userId = (
    await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email='mes-a@example.invalid'",
    )
  ).rows[0].id;
  a = (await identity(db, await issueSession(db, userId)))!;

  const bank = randomUUID();
  await run(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Banco mês A','Instituição fictícia','BRL','checking',0,'2025-12-31',$3)",
    [bank, a.familyId, a.userId],
  );
  await run(
    "UPDATE accounts SET balance_confirmed_cents=500000,balance_confirmed_at=$2 WHERE id=$1",
    [bank, TODAY],
  );

  // Aluguel de novembro e internet de dezembro: fluxos de meses diferentes.
  for (const [month, label, cents, due] of [
    ["2026-11-01", "Aluguel", 120000, "2026-11-18"],
    ["2026-12-01", "Internet", 30000, "2026-12-10"],
  ] as const)
    await run(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,status,created_by)
       VALUES($1,$2,$3,$4,'expense','BRL',$5,$6,'open',$7)`,
      [randomUUID(), a.familyId, month, label, cents, due, a.userId],
    );

  // Salário previsto em 20/11 (regra + item de renda + ocorrência planejada).
  const ruleId = await seedIncomeSeries(run, {
    familyId: a.familyId,
    userId: a.userId,
    accountId: bank,
    day: 20,
    cents: 600000,
  });
  const incomeItem = randomUUID();
  await run(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,status,created_by)
     VALUES($1,$2,'2026-11-01','Salário','income','BRL',600000,'open',$3)`,
    [incomeItem, a.familyId, a.userId],
  );
  await seedIncomeOccurrence(run, {
    familyId: a.familyId,
    recurrenceId: ruleId,
    itemId: incomeItem,
    occurrenceDate: "2026-11-20",
    expectedDate: "2026-11-20",
    state: "planned",
  });
});

after(async () => {
  await db?.close();
});

test("current: igual ao readProjection nos campos-chave, mais modo e limites", async () => {
  const base = toProjectionWire(await readProjection(db, a, { today: TODAY }));
  const month = await readProjectionMonth(db, a, "2026-11", { today: TODAY });
  assert.equal(month.mode, "current");
  assert.equal(month.monthStart, "2026-11-01");
  assert.equal(month.monthEnd, "2026-11-30");
  if (month.mode !== "current") return;
  assert.equal(month.statusWord, "Confiável");
  for (const k of [
    "today",
    "horizonEnd",
    "sConf",
    "state",
    "shown",
    "nextIncomeDate",
    "low",
    "deficit",
    "flows",
    "gaps",
    "needed",
  ] as const)
    assert.deepEqual(month[k], base[k], k);
  // Caminho do saldo: começa hoje e vai até o fim do mês, além do horizonte.
  assert.equal(month.series[0].day, TODAY);
  assert.equal(month.series[month.series.length - 1].day, "2026-11-30");
  // Sem month = mês atual (retrocompat).
  const implicit = await readProjectionMonth(db, a, undefined, {
    today: TODAY,
  });
  assert.equal(implicit.mode, "current");
});

test("future: dezembro recortado ao mês, shown null, fluxos só de dezembro", async () => {
  const dec = await readProjectionMonth(db, a, "2026-12", { today: TODAY });
  assert.equal(dec.mode, "future");
  if (dec.mode !== "future") return;
  assert.equal(dec.statusWord, "Estimativa");
  assert.equal(dec.monthStart, "2026-12-01");
  assert.equal(dec.monthEnd, "2026-12-31");
  assert.equal(dec.shown, null);
  assert.equal(dec.horizonEnd, "2026-12-31");

  // Fluxos de dezembro entram; os de novembro ficam de fora.
  const labels = dec.flows.map((f) => f.label);
  assert.ok(labels.includes("Internet"), "internet de dezembro");
  assert.ok(!labels.includes("Aluguel"), "aluguel de novembro fora");
  for (const f of dec.flows)
    assert.ok(
      f.cons.date >= "2026-12-01" && f.cons.date <= "2026-12-31",
      f.key,
    );

  // Série, low e deficit só dentro do mês.
  assert.equal(dec.series[0].day, "2026-12-01");
  for (const p of dec.series)
    assert.ok(p.day >= "2026-12-01" && p.day <= "2026-12-31", p.day);
  assert.ok(dec.low.cons.day >= "2026-12-01" && dec.low.cons.day <= "2026-12-31");
  assert.ok(dec.low.nom.day >= "2026-12-01" && dec.low.nom.day <= "2026-12-31");
  if (dec.deficit) assert.ok(dec.deficit.day >= "2026-12-01");
});

test("future: startCents de dezembro == curva até 01/12", async () => {
  // A curva do mês atual para na véspera do salário; a de dezembro vai até
  // 31/12 e passa por 01/12, o mesmo ponto de partida.
  const curve = await readProjection(db, a, { today: TODAY, horizonEnd: "2026-12-31" });
  const expected = startCentsAt(curve.series, "2026-12-01");
  assert.ok(expected !== null);
  const dec = await readProjectionMonth(db, a, "2026-12", { today: TODAY });
  assert.equal(dec.mode, "future");
  if (dec.mode !== "future") return;
  assert.equal(dec.startCents, expected!.toString());
  // 500000 - aluguel 120000 + salário 600000 = 980000 (cons).
  assert.equal(dec.startCents, "980000");
});

test("closed: mês anterior não roda o motor (só modo, palavra e limites)", async () => {
  const oct = await readProjectionMonth(db, a, "2026-10", { today: TODAY });
  assert.deepEqual(oct, {
    mode: "closed",
    statusWord: "Realizado",
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
  });
});

test("unavailable: dois meses à frente não roda o motor", async () => {
  const jan = await readProjectionMonth(db, a, "2027-01", { today: TODAY });
  assert.deepEqual(jan, {
    mode: "unavailable",
    statusWord: "Sem projeção",
    monthStart: "2027-01-01",
    monthEnd: "2027-01-31",
  });
});
