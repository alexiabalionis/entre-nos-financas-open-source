import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import {
  balanceSeries,
  categoryByMonth,
  categoryPeriods,
  dailySpend,
  fixedSplit,
  monthSummary,
  places,
  type Spend,
  insightsAnchor,
} from "../src/domain/insights.ts";
import { readCategorySpend, readInsights } from "../src/server/insights.ts";
import {
  categoryTrend,
  categoryTrendReading,
  daysReading,
  inOutReading,
  monthBreakdown,
  placesReading,
  sortPlaces,
  trendChartValues,
} from "../app/insights/model.ts";
import { moneyOf } from "../app/copilot/money.ts";
import { readSpendProfile } from "../src/server/copilot-reads.ts";
import { setupWorld, spend as manualSpend } from "./no-double-count-helpers.ts";
import { negativeRow } from "./value-contracts-helpers.ts";

const TODAY = "2026-11-11";
const s = (
  date: string,
  reais: number,
  merchant: string,
  categoryName: string | null = null,
  eventId: string | null = null,
): Spend => ({
  date,
  cents: BigInt(reais * 100),
  merchant,
  categoryName,
  eventId,
});

test("monthSummary: médias só dos meses fechados, sobra e melhor mês", () => {
  const months = [
    { month: "2026-09", in: 2000000n, out: 1800000n },
    { month: "2026-10", in: 2000000n, out: 1600000n },
    { month: "2026-11", in: 500000n, out: 900000n },
  ];
  const r = monthSummary(months, "2026-11")!;
  assert.equal(r.months, 2);
  assert.equal(r.avgIn, 2000000n);
  assert.equal(r.avgOut, 1700000n);
  assert.equal(r.keptAvg, 300000n);
  assert.equal(r.keptPct, 15);
  assert.deepEqual(r.best, { month: "2026-10", kept: 400000n });
  assert.equal(monthSummary([{ month: "2026-11", in: 1n, out: 0n }], "2026-11"), null);
});

test("categoryPeriods: este mês contra os mesmos dias do mês passado", () => {
  const spend = [
    s("2026-11-03", 300, "IFOOD", "Alimentação fora"),
    s("2026-10-05", 100, "IFOOD", "Alimentação fora"),
    s("2026-10-25", 900, "IFOOD", "Alimentação fora"), // depois do dia 11: fora da comparação
    s("2026-08-10", 50, "UBER", "Transporte"),
  ];
  const r = categoryPeriods(spend, TODAY);
  assert.deepEqual(r.month, [{ name: "Alimentação fora", cents: 30000n, prev: 10000n }]);
  assert.deepEqual(r.lastMonth, [{ name: "Alimentação fora", cents: 100000n, prev: null }]);
  assert.deepEqual(
    r.quarter.map((c) => c.name),
    ["Alimentação fora", "Transporte"],
  );
});

test("4a: fixedSplit conta como fixo só o evento de conta fixa, nunca a categoria; dailySpend e places", () => {
  const spend = [
    s("2026-11-05", 2900, "ALUGUEL", "Moradia", "ev-aluguel"),
    s("2026-11-05", 40, "IFOOD", "Alimentação fora"),
    s("2026-11-07", 60, "IFOOD", "Alimentação fora"),
    // Mesma categoria do aluguel, mas sem série: é dia a dia.
    s("2026-11-08", 100, "REFORMA", "Moradia", "ev-reforma"),
    s("2026-09-07", 30, "IFOOD", null),
  ];
  assert.deepEqual(fixedSplit(spend, { month: "2026-11", fixedEvents: new Set(["ev-aluguel"]) }), {
    fixed: 290000n,
    everyday: 20000n,
  });
  const days = dailySpend(spend, TODAY);
  assert.equal(days.length, 30);
  assert.equal(days[4], 294000n);
  assert.equal(days[5], 0n);
  assert.equal(days[11], null, "depois de hoje fica vazio");
  const list = places(spend, "2026-09-01");
  assert.deepEqual(list[1], {
    merchant: "IFOOD",
    category: "Alimentação fora",
    visits: 3,
    total: 13000n,
    average: 4333n,
    last: "2026-11-07",
  });
});

test("balanceSeries: soma as contas a partir do saldo inicial de cada uma", () => {
  const out = balanceSeries({
    from: "2026-11-01",
    to: "2026-11-04",
    accounts: [
      { id: "a", openingCents: 100000n, openingDate: "2026-10-01" },
      { id: "b", openingCents: 50000n, openingDate: "2026-11-03" },
    ],
    moves: [
      { account: "a", date: "2026-10-15", cents: -20000n },
      { account: "a", date: "2026-11-02", cents: -10000n },
      { account: "b", date: "2026-11-04", cents: 5000n },
    ],
  });
  assert.deepEqual(
    out.map((p) => [p.day, p.cents]),
    [
      ["2026-11-01", 80000n],
      ["2026-11-02", 70000n],
      ["2026-11-03", 120000n],
      ["2026-11-04", 125000n],
    ],
  );
});

test("leituras: meses no negativo, dia da semana que pesa e compras pequenas", () => {
  const money = moneyOf(false);
  const wire = {
    today: TODAY,
    months: [
      { month: "2026-09", in: "100", out: "200" },
      { month: "2026-10", in: "300", out: "100" },
      { month: "2026-11", in: "0", out: "900" },
    ],
    days: Array.from({ length: 30 }, (_, i) => (i < 11 ? (i === 6 ? "90000" : "10000") : null)),
  } as never;
  assert.equal(inOutReading(wire, "tri"), "Saiu mais do que entrou em Set.");
  // 07/11/2026 é sábado.
  assert.match(daysReading(wire, money), /^Os sábados pesam mais: em média R\$ 800,00/);
  const list = [
    { merchant: "IFOOD", label: "Ifood", category: null, visits: 30, total: "174000", average: "5800", last: "2026-11-10" },
    { merchant: "ALUGUEL", label: "Aluguel", category: null, visits: 3, total: "870000", average: "290000", last: "2026-11-05" },
  ];
  assert.deepEqual(sortPlaces(list, "visits").map((p) => p.merchant), ["IFOOD", "ALUGUEL"]);
  assert.deepEqual(sortPlaces(list, "total").map((p) => p.merchant), ["ALUGUEL", "IFOOD"]);
  assert.equal(placesReading(list, money), "Ifood soma R$ 1.740,00: muitas compras pequenas, 30 vezes no período.");
});

test("readInsights: lê meses, gastos, lugares e saldo da família", async () => {
  const db = await openDatabase();
  try {
    const email = "insights@example.invalid";
    await createFamily(db, { email, name: "I", password: "SenhaFicticia!2026", familyName: "I" });
    const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
    const user = (await identity(db, await issueSession(db, userId)))!;
    const bank = randomUUID();
    await asUser(db, user.userId, (tx) =>
      tx.query(
        "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',100000,'2026-10-01',$3)",
        [bank, user.familyId, user.userId],
      ),
    );
    const event = (date: string, kind: "expense" | "income", cents: number, description: string) =>
      asUser(db, user.userId, async (tx) => {
        const id = randomUUID();
        const signed = kind === "expense" ? -cents : cents;
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$6,$7,'BRL',$8)`,
          [id, user.familyId, bank, kind, date, description, signed, user.userId],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,$9,'BRL',$7,$8)`,
          [randomUUID(), user.familyId, id, bank, randomUUID(), signed, -signed, date, kind],
        );
      });
    await event("2026-10-05", "income", 500000, "SALARIO");
    await event("2026-10-10", "expense", 4000, "IFOOD");
    await event("2026-11-03", "expense", 6000, "IFOOD");

    const r = await readInsights(db, user, { today: TODAY });
    assert.equal(r.months.length, 12);
    assert.deepEqual(r.months.at(-2), { month: "2026-10", in: 500000n, out: 4000n });
    assert.equal(r.summary?.best.month, "2026-10");
    assert.equal(r.places.quarter[0].visits, 2);
    assert.equal(r.places.quarter[0].label, "Ifood");
    assert.equal(r.days[2], 6000n);
    assert.equal(r.balance[0].day, "2026-10-01");
    assert.equal(r.balance.at(-1)?.cents, 100000n + 500000n - 4000n - 6000n);
  } finally {
    await db.close();
  }
});

test("categoryPeriods: negativo preservado, sem categoria agrupada e líquido zero some", () => {
  const spend = [
    s("2026-11-03", 100, "A", "Mercado"),
    s("2026-11-04", -30, "A", "Mercado"),
    s("2026-11-05", 50, "B", null),
    s("2026-11-06", -20, "C", "Vestuário"),
    s("2026-11-12", 999, "D", "Mercado"), // depois de hoje: fora do mês até hoje
    s("2026-10-02", 40, "A", "Mercado"),
    s("2026-10-20", 500, "A", "Mercado"), // depois do dia 11: fora da comparação
    s("2026-10-05", 20, "B", null),
    s("2026-09-15", 70, "E", "Lazer"),
    s("2026-09-16", -70, "E", "Lazer"), // líquido zero: não aparece
    s("2026-08-20", 10, "A", "Mercado"),
  ];
  const r = categoryPeriods(spend, TODAY);
  assert.deepEqual(r.month, [
    { name: "Mercado", cents: 7000n, prev: 4000n },
    { name: "Sem categoria", cents: 5000n, prev: 2000n },
    { name: "Vestuário", cents: -2000n, prev: 0n },
  ]);
  assert.deepEqual(r.lastMonth, [
    { name: "Mercado", cents: 54000n, prev: null },
    { name: "Sem categoria", cents: 2000n, prev: null },
  ]);
  assert.deepEqual(r.quarter, [
    { name: "Mercado", cents: 55000n, prev: null },
    { name: "Sem categoria", cents: 2000n, prev: null },
  ]);
});

test("readSpendProfile: categoria sem nome fica de fora e estorno abate o excesso", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "spend-profile", TODAY);
    await manualSpend(w, { date: "2026-09-10", description: "MERCADO", cents: 56000, category: w.market });
    await manualSpend(w, { date: "2026-09-01", description: "ANTIGO", cents: 99999, category: w.market }); // antes da janela
    await manualSpend(w, { date: "2026-11-05", description: "MERCADO", cents: 20000, category: w.market });
    await manualSpend(w, { date: "2026-11-04", description: "ALUGUEL", cents: 3000, category: w.housing });
    const uncategorized = await manualSpend(w, { date: "2026-11-06", description: "SEM CATEGORIA", cents: 90000, category: w.market });
    await db.query("UPDATE economic_events SET category_id=NULL WHERE id=$1", [uncategorized]);
    await negativeRow(w, { date: "2026-11-07", cents: 1000, category: w.housing });
    const { overspent } = await asUser(db, w.user.userId, (tx) =>
      readSpendProfile(tx, { familyId: w.user.familyId, today: TODAY }),
    );
    assert.deepEqual(overspent, [
      { category: "Alimentação", over: 9000n },
      { category: "Moradia", over: 2000n },
    ]);
  } finally {
    await db.close();
  }
});

test("categoryByMonth: agrupa por mês, mantém negativo e omite líquido zero", () => {
  const spend = [
    s("2026-10-02", 40, "A", "Mercado"),
    s("2026-10-03", 10, "B", null),
    s("2026-11-03", 100, "A", "Mercado"),
    s("2026-11-04", -130, "C", "Lazer"),
    s("2026-11-05", 20, "C", "Lazer"),
    s("2026-11-06", 5, "D", "Zero"),
    s("2026-11-07", -5, "D", "Zero"),
    s("2026-07-01", 999, "E", "Fora"), // mês fora da lista
  ];
  assert.deepEqual(categoryByMonth(spend, ["2026-10", "2026-11"]), [
    { month: "2026-10", name: "Mercado", cents: 4000n },
    { month: "2026-10", name: "Sem categoria", cents: 1000n },
    { month: "2026-11", name: "Mercado", cents: 10000n },
    { month: "2026-11", name: "Lazer", cents: -11000n },
  ]);
});

test("readInsights: categoryMonths fecha com a saída de cada mês, estorno incluso", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "category-months", TODAY);
    await manualSpend(w, { date: "2026-10-10", description: "MERCADO", cents: 10000, category: w.market });
    await manualSpend(w, { date: "2026-11-03", description: "ALUGUEL", cents: 5000, category: w.housing });
    await negativeRow(w, { date: "2026-11-07", cents: 8000, category: w.market });
    const r = await readInsights(db, w.user, { today: TODAY });
    for (const m of r.months) {
      const sum = r.categoryMonths.filter((c) => c.month === m.month).reduce((t, c) => t + c.cents, 0n);
      assert.equal(sum, m.out, m.month);
    }
    assert.equal(r.months.at(-1)!.out, -3000n);
    assert.ok(r.categoryMonths.some((c) => c.name === "Alimentação" && c.cents === -8000n));
  } finally {
    await db.close();
  }
});

const trendWire = (extra: { month: string; name: string; cents: string }[] = []) =>
  ({
    today: TODAY,
    months: ["2026-09", "2026-10", "2026-11"].map((month) => ({ month, in: "0", out: "0" })),
    categoryMonths: [
      ["2026-09", "Mercado", "30000"],
      ["2026-09", "Restaurantes", "10000"],
      ["2026-09", "Lazer", "1000"],
      ["2026-09", "Sem categoria", "2000"],
      ["2026-10", "Mercado", "30000"],
      ["2026-10", "Restaurantes", "30000"],
      ["2026-10", "Lazer", "1000"],
      ["2026-10", "Sem categoria", "2000"],
      ["2026-11", "Mercado", "20000"],
      ["2026-11", "Restaurantes", "5000"],
      ["2026-11", "Lazer", "1000"],
      ...extra.map((e) => [e.month, e.name, e.cents]),
    ].map(([month, name, cents]) => ({ month, name, cents })),
  }) as never;

test("categoryTrend: à vista, Sem categoria própria, resto em Outras e média dos fechados", () => {
  const w = trendWire();
  const t = categoryTrend(w, "tri");
  assert.deepEqual(t.layers, ["Mercado", "Restaurantes", "Sem categoria", "Outras"]);
  assert.deepEqual(t.cents, [
    [30000n, 10000n, 2000n, 1000n],
    [30000n, 30000n, 2000n, 1000n],
    [20000n, 5000n, 0n, 1000n],
  ]);
  // Média só de Set e Out: o mês atual fica de fora.
  assert.deepEqual(t.average, [30000n, 20000n, 2000n, 1000n]);
  assert.deepEqual(trendChartValues(t)[2], [200, 50, 0, 10]);
});

test("categoryTrend: fecha com o total de cada mês, inclusive com estorno", () => {
  const extra = [{ month: "2026-11", name: "Vestuário", cents: "-3000" }];
  const w = trendWire(extra) as { categoryMonths: { month: string; cents: string }[] };
  const t = categoryTrend(w as never, "tri");
  t.months.forEach((month, i) => {
    const expected = w.categoryMonths.filter((r) => r.month === month).reduce((s, r) => s + BigInt(r.cents), 0n);
    assert.equal(t.cents[i].reduce((s, c) => s + c, 0n), expected, month);
  });
  // O desenho ignora o valor negativo; o dado não.
  assert.equal(t.cents[2][t.layers.indexOf("Outras")], -2000n);
  assert.equal(trendChartValues(t)[2][t.layers.indexOf("Outras")], 0);
});

test("monthBreakdown e categoryTrendReading: só destacam o que destoa", () => {
  const money = moneyOf(false);
  const t = categoryTrend(trendWire(), "tri");
  const oct = monthBreakdown(t, 1, TODAY);
  assert.deepEqual(oct.map((r) => [r.name, r.percent, r.above]), [
    ["Mercado", 47, false],
    ["Restaurantes", 47, true],
    ["Sem categoria", 3, false],
    ["Outras", 1, false],
  ]);
  // O mês atual nunca leva a etiqueta de acima da média.
  assert.ok(monthBreakdown(t, 2, TODAY).every((r) => !r.above));
  assert.equal(
    categoryTrendReading(t, money, TODAY),
    `Mercado pesa 60% das saídas do período. Em Out, Restaurantes ficou ${money(10000n)} acima da média.`,
  );
  const calm = categoryTrend(
    { today: TODAY, months: [{ month: "2026-10" }], categoryMonths: [
      { month: "2026-10", name: "A", cents: "10000" },
      { month: "2026-10", name: "B", cents: "10000" },
      { month: "2026-10", name: "C", cents: "10000" },
      { month: "2026-10", name: "D", cents: "10000" },
    ] } as never,
    "tri",
  );
  assert.equal(categoryTrendReading(calm, money, TODAY), "");
});

test("readCategorySpend: todas as categorias de um mês, mesma conta do Panorama", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "category-spend", TODAY);
    await manualSpend(w, { date: "2026-10-10", description: "MERCADO", cents: 10000, category: w.market });
    await manualSpend(w, { date: "2026-11-03", description: "ALUGUEL", cents: 5000, category: w.housing });
    await negativeRow(w, { date: "2026-11-07", cents: 8000, category: w.market });
    const r = await readInsights(db, w.user, { today: TODAY });
    const nov = await readCategorySpend(db, w.user, "2026-11");
    assert.equal(nov.month, "2026-11");
    // Mesmas linhas de categoryMonths, do maior para o menor, só do mês pedido.
    assert.deepEqual(
      nov.categories.map(({ name, cents }) => ({ name, cents })),
      r.categoryMonths
        .filter((c) => c.month === "2026-11")
        .map(({ name, cents }) => ({ name, cents }))
        .sort((a, b) => (a.cents < b.cents ? 1 : a.cents > b.cents ? -1 : 0)),
    );
    // Cada categoria traz suas compras, e elas somam o total da categoria.
    for (const c of nov.categories)
      assert.equal(
        c.items.reduce((s, i) => s + i.cents, 0n),
        c.cents,
        c.name,
      );
    const housing = nov.categories.find((c) => c.items.some((i) => i.cents === 5000n))!;
    assert.deepEqual(housing.items.map((i) => [i.date, i.label]), [["2026-11-03", "Aluguel"]]);
    assert.equal(nov.total_cents, r.months.at(-1)!.out);
    const oct = await readCategorySpend(db, w.user, "2026-10");
    assert.deepEqual(oct.categories.map((c) => c.name), ["Alimentação"]);
  } finally {
    await db.close();
  }
});

test("insightsAnchor: mês passado ancora no último dia; atual e futuro ficam em hoje", () => {
  assert.deepEqual(insightsAnchor("2026-11-19"), { today: "2026-11-19", current: true, future: false });
  assert.deepEqual(insightsAnchor("2026-11-19", "2026-11"), { today: "2026-11-19", current: true, future: false });
  assert.deepEqual(insightsAnchor("2026-11-19", "2026-12"), { today: "2026-11-19", current: true, future: true });
  assert.deepEqual(insightsAnchor("2026-11-19", "2026-08"), { today: "2026-08-31", current: false, future: false });
  assert.deepEqual(insightsAnchor("2026-11-19", "2024-02"), { today: "2024-02-29", current: false, future: false });
});

test("readInsights com mês passado: dias e categorias são do mês escolhido", async () => {
  const db = await openDatabase();
  try {
    const email = "insights-month@example.invalid";
    await createFamily(db, { email, name: "M", password: "SenhaFicticia!2026", familyName: "M" });
    const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
    const user = (await identity(db, await issueSession(db, userId)))!;
    const r = await readInsights(db, user, { today: TODAY, month: "2026-09" });
    assert.equal(r.today, "2026-09-30");
    assert.equal(r.current, false);
    assert.equal(r.months.at(-1)?.month, "2026-09");
    assert.equal(r.days.length, 30);
  } finally {
    await db.close();
  }
});
