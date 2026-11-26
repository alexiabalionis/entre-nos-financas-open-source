import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, asUser } from "../src/server/db.ts";
import { readInsights } from "../src/server/insights.ts";
import { readSpendProfile } from "../src/server/copilot-reads.ts";
import { readBudgetReference } from "../src/server/budget-reference.ts";
import { readProjection } from "../src/server/projection.ts";
import { checkItem, readRoutine, saveItem } from "../src/server/routine.ts";
import { categoryPeriods, dailySpend, fixedSplit, places, type Spend } from "../src/domain/insights.ts";
import { weeklyRate, weeklyTotals } from "../src/domain/everyday.ts";
import { categoryOutflow } from "../src/domain/budget.ts";
import { percentShares } from "../app/ds/chart-data.ts";
import { analyzeMonth } from "../app/month-analysis.ts";
import { daysReading } from "../app/insights/model.ts";
import { outflowRows, outflowTotals } from "../app/budgets/outflow-model.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { itemFlows, outTotal, spend, TODAY as PLAN_TODAY } from "./no-double-count-helpers.ts";
import { TODAY, bankWorld, negativeRow, stateOf } from "./value-contracts-helpers.ts";

// Etapa 1b: caracterização de valores NEGATIVOS e de pagamento manual.
// SONDA = linha negativa sintética (negativeRow), que simula o que os
// consumidores receberiam se o leitor compartilhado passasse a devolver
// estornos. Cada asserção guarda o comportamento ATUAL; nada aqui define a
// regra futura. Nada altera src/ nem app/.

const s = (date: string, cents: bigint, categoryName: string | null = "Mercado", eventId: string | null = null): Spend => ({
  date,
  cents,
  merchant: "LOJA",
  categoryName,
  eventId,
});

test("8. categoria com consumo líquido negativo: listas preservam o sinal e fecham com o total", async () => {
  // Puro: a categoria líquida negativa continua na lista; a soma fecha com o total líquido.
  const spend8 = [s("2026-11-03", 10000n, "Mercado"), s("2026-11-04", 13000n, "Lazer"), s("2026-11-05", -13000n - 2000n, "Lazer")];
  const month = categoryPeriods(spend8, TODAY).month;
  assert.deepEqual(month.map((r) => [r.name, r.cents]), [["Mercado", 10000n], ["Lazer", -2000n]]);
  assert.equal(month.reduce((t, r) => t + r.cents, 0n), 8000n);
  assert.equal(spend8.reduce((t, r) => t + r.cents, 0n), 8000n);
  // Tetos: categoryOutflow só pula a categoria sem movimento.
  const rows = categoryOutflow(new Map([["a", 5000n], ["b", -3000n], ["c", 0n]]), []);
  assert.deepEqual(rows.map((r) => [r.category_id, r.committed_cents]), [["a", 5000n], ["b", -3000n]]);

  // Com dados reais: estorno em novembro sem compra em novembro.
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-cat-negativa");
    const purchase = await spend(w, { date: "2026-10-10", description: "MERCADO", cents: 10000, category: w.market });
    await asUser(db, w.user.userId, (tx) =>
      createManualEventTx(tx, w.user, {
        account_id: w.bank,
        date: "2026-11-05",
        description: "ESTORNO MERCADO",
        amount: "30,00",
        kind: "refund",
        category_id: w.market,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: purchase,
      }),
    );
    const state = await stateOf(w, "2026-11");
    assert.equal(state.summary.expense_cents, "-3000");
    // A linha negativa aparece e fecha com o total; a fatia de proporção pesa 0%.
    const outflow = outflowRows(state as never);
    assert.deepEqual(outflow.map((r) => [r.spent, r.percent]), [[-3000n, 0]]);
    assert.equal(outflowTotals(state as never).spent, -3000n);
  } finally {
    await db.close();
  }
});

test("9. dia e semana negativos: o dia fica negativo; a semana já é zerada pelo ritmo", async () => {
  // Puro.
  const days = dailySpend([s("2026-11-02", 1000n), s("2026-11-03", -400n)], TODAY);
  assert.equal(days[1], 1000n);
  assert.equal(days[2], -400n); // sem limite: o dia líquido fica negativo
  assert.deepEqual(places([s("2026-11-03", -400n)], "2026-11-01"), []); // lugares ignoram <= 0
  const weeks = weeklyTotals({ rows: [{ date: "2026-09-08", cents: -500n }], windowStart: "2026-09-07" });
  assert.equal(weeks[0], 0n); // única normalização existente: semana líquida negativa vira 0
  assert.equal(weeklyRate(weeks), null);
  assert.deepEqual(percentShares([300, -100, 100]), [75, 0, 25]); // fatia negativa pesa 0

  // Sonda no leitor real de Insights.
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-dia-negativo");
    await negativeRow(w, { date: "2026-11-07", cents: 2000 });
    const insights = await readInsights(w.db, w.user, { today: TODAY });
    assert.equal(insights.days[6], -2000n);
    // Categoria líquida negativa fica na lista e a soma fecha com os dias e o fluxo mensal.
    assert.deepEqual(insights.categories.month.map((c) => c.cents), [-2000n]);
    assert.deepEqual(insights.places.quarter, []);
    assert.equal(insights.fixed.everyday, -2000n);
    assert.equal(insights.months.find((m) => m.month === "2026-11")!.out, -2000n);
    // A leitura por dia da semana não quebra com dia negativo.
    assert.equal(typeof daysReading({ today: TODAY, days: insights.days } as never, (c) => String(c)), "string");
  } finally {
    await db.close();
  }
});

test("10. alerta de excesso: histórico líquido negativo (sonda) vale zero e não aumenta o excesso", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-excesso");
    await spend(w, { date: "2026-11-05", description: "MERCADO", cents: 3000, category: w.market });
    const profile = () =>
      asUser(db, w.user.userId, (tx) => readSpendProfile(tx, { familyId: w.user.familyId, today: TODAY }));
    const base = (await profile()).overspent;
    assert.equal(base.length, 1);
    assert.equal(base[0].over, 3000n); // sem histórico: o excesso é o gasto inteiro
    // Janela anterior com consumo líquido negativo (hoje inalcançável, pois estorno não entra no leitor).
    await negativeRow(w, { date: "2026-10-10", cents: 5000 });
    const withNegative = (await profile()).overspent;
    // O histórico líquido negativo vale zero: o excesso continua igual ao do caso sem histórico.
    assert.equal(withNegative[0].over, 3000n);
  } finally {
    await db.close();
  }
});

test("11. referência de teto: mês líquido negativo (sonda) aparece na lista e vale zero na mediana", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-referencia");
    await spend(w, { date: "2026-06-10", description: "MERCADO", cents: 10000, category: w.market });
    for (const date of ["2026-07-10", "2026-08-10", "2026-09-10"]) await negativeRow(w, { date, cents: 2000 });
    await spend(w, { date: "2026-10-10", description: "MERCADO", cents: 10000, category: w.market });
    const ref = await readBudgetReference(w.db, w.user, { category_id: w.market, month: "2026-11" }, { today: "2026-11-15" });
    assert.deepEqual(ref.months.map((m) => m.cents), ["10000", "-2000", "-2000", "-2000", "10000"]);
    // A lista mantém o sinal; mediana e maior usam piso zero (magnitude habitual).
    assert.equal(ref.median_cents, "0");
    assert.equal(ref.max_cents, "10000");
  } finally {
    await db.close();
  }
});

test("12. pagamento manual seguido de conciliação: parcial, banco chega, evento ligado ao item", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-manual-conciliacao");
    const { id } = (await saveItem(db, w.user, {
      month: "2026-11",
      label: "Feira",
      purpose: "expense",
      currency: "BRL",
      amount: "150,00",
      due_date: null,
      category_id: w.market,
    })) as { id: string };
    const version = async () =>
      (await db.query<{ version: number }>("SELECT version FROM monthly_items WHERE id=$1", [id])).rows[0].version;
    const totals = async () => {
      const state = await stateOf(w, "2026-11");
      return {
        spent: state.summary.expense_cents,
        open: state.outflow.reduce((t, o) => t + BigInt(o.open_planned_cents), 0n).toString(),
      };
    };
    // "Pago sem lançamento" derivado só de monthly_items (sem persistência nova).
    const unlinked = async () =>
      (
        await db.query<{ v: string }>(
          `SELECT coalesce(sum(paid_cents),0)::text AS v FROM monthly_items
           WHERE household_id=$1 AND to_char(month,'YYYY-MM')='2026-11' AND purpose IN ('expense','benefit')
             AND status IN ('partial','done') AND event_id IS NULL AND NOT archived AND NOT derived AND paid_cents>0`,
          [w.user.familyId],
        )
      ).rows[0].v;
    const planCommitted = async () =>
      analyzeMonth((await readRoutine(w.db, w.user, "2026-11")).items, "2026-11", { today: TODAY }).committed;

    assert.deepEqual(await totals(), { spent: "0", open: "15000" });
    // 1) parcial manual de R$ 60, sem evento.
    await checkItem(db, w.user, { id, version: await version(), status: "partial", amount: "60,00", date: "2026-11-03", event_id: null });
    assert.deepEqual(await totals(), { spent: "0", open: "9000" });
    assert.equal(await unlinked(), "6000");
    // O plano do Mês ainda conta o planejado inteiro de um item parcial (status != done).
    assert.equal(await planCommitted(), "15000");
    // 2) a linha do banco chega: o gasto entra uma vez; o derivado ainda mostra o pago (sobreposição visível).
    const line = await w.pending({ local: w.bank, date: "2026-11-03", description: "PIX FEIRA", cents: -6000, group: "expense" });
    assert.deepEqual(await totals(), { spent: "6000", open: "9000" });
    assert.equal(await unlinked(), "6000");
    // 3) aprovação do banco como evento e vínculo ao item (ainda parcial).
    const event = await spend(w, { date: "2026-11-03", description: "PIX FEIRA", cents: 6000, category: w.market });
    await db.query("UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2", [event, line]);
    await checkItem(db, w.user, { id, version: await version(), status: "partial", amount: "60,00", date: "2026-11-03", event_id: event });
    assert.equal(await unlinked(), "0");
    // Item parcial ligado a evento: o restante de R$ 90 continua em aberto (sem dupla contagem com os R$ 60).
    assert.deepEqual(await totals(), { spent: "6000", open: "9000" });
    // A projeção de caixa mantém o restante de R$ 90 como saída prevista.
    const report = await readProjection(db, w.user, { today: PLAN_TODAY });
    assert.equal(outTotal(itemFlows(report, id)), 9000n);
  } finally {
    await db.close();
  }
});

test("13. estorno de conta fixa hoje abate o dia a dia, não o fixo (caracterização)", () => {
  const rows = [s("2026-11-05", 29000n, "Moradia", "ev-aluguel"), s("2026-11-08", -5000n, "Moradia", "ev-estorno")];
  assert.deepEqual(fixedSplit(rows, { month: "2026-11", fixedEvents: new Set(["ev-aluguel"]) }), {
    fixed: 29000n,
    everyday: -5000n,
  });
});
