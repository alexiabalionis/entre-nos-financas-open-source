import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { readState } from "../src/server/state.ts";
import { readRoutine } from "../src/server/routine.ts";
import { readProjection } from "../src/server/projection.ts";
import { readCopilot } from "../src/server/copilot.ts";
import { readUsualBreakdown } from "../src/server/projection-reads-everyday.ts";
import { readInsights } from "../src/server/insights.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { applyFromDate, createRecurrence, endRecurrence, previewFromDate } from "../src/server/recurrence-series.ts";
import {
  TODAY,
  fixedBill,
  itemFlows,
  outTotal,
  reconcile,
  setupWorld,
  slotsOf,
  spend,
  type World,
} from "./no-double-count-helpers.ts";

// Etapa 4e: conta fixa, conciliação, cartão e teto não contam o mesmo dinheiro
// duas vezes no Mês, no Copiloto, na projeção, no dia a dia e no Panorama.

const HISTORY = ["2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"];

const ceiling = (w: World, month: string, cents: number) =>
  w.db.query(
    "INSERT INTO budgets(household_id,category_id,month,currency,planned_cents) VALUES($1,$2,$3,'BRL',$4)",
    [w.user.familyId, w.housing, month, cents],
  );
const history = async (w: World) => {
  for (const d of HISTORY) await spend(w, { date: d, description: "FEIRA " + d, cents: 1000, category: w.market });
};
const budgetOf = async (w: World, month: string) =>
  (await readState(w.db, w.user, month + "-01", "BRL")).budgets.find((b) => b.category_id === w.housing)!;
const usual = (w: World) =>
  asUser(w.db, w.user.userId, (tx) => readUsualBreakdown(tx, { familyId: w.user.familyId, today: TODAY }));
const budgetRows = async (w: World) =>
  (
    await w.db.query(
      "SELECT category_id,month::text,currency,planned_cents::text FROM budgets WHERE household_id=$1 ORDER BY category_id,month",
      [w.user.familyId],
    )
  ).rows;
const versionsOf = (p: Awaited<ReturnType<typeof previewFromDate>>) =>
  Object.fromEntries([...p.groups.replaced, ...p.groups.edited, ...p.groups.preserved].map((e) => [e.monthly_item_id, e.version]));

// Conta fixa de R$150 em dinheiro, prevista para 12/11 e paga R$165 em 05/11.
async function paidCashBill(w: World) {
  await history(w);
  await ceiling(w, "2026-11-01", 20000);
  const series = await fixedBill(w, { label: "Condomínio", cents: 15000, start: "2026-11-12", frequency: "year" });
  const [slot] = await slotsOf(w.db, series);
  const pay = async () => {
    const eventId = await spend(w, { date: "2026-11-05", description: "CONDOMINIO RESIDENCIAL", cents: 16500 });
    await reconcile(w, slot, { eventId, cents: 16500, date: "2026-11-05" });
    return eventId;
  };
  return { slot, pay };
}

test("1. conta fixa em dinheiro: prevista 150, paga 165 e conciliada conta 165 uma vez em tudo", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "cash");
    const { slot, pay } = await paidCashBill(w);

    // Antes: 150 previstos em aberto, uma saída de 150 na projeção e no Copiloto.
    let b = await budgetOf(w, "2026-11");
    assert.deepEqual([b.spent_cents, b.open_planned_cents, b.committed_cents], ["0", "15000", "15000"]);
    let report = await readProjection(db, w.user, { today: TODAY, copilot: true });
    assert.deepEqual(
      itemFlows(report, slot.id).map((f) => [f.key, f.cons.date, f.cons.cents]),
      [[`item:${slot.id}`, "2026-11-12", 15000n]],
    );
    assert.equal((await readCopilot(db, w.user, { today: TODAY })).breakdown.bills, 15000n);
    assert.equal((await usual(w)).usual_weekly_cents, "1000");

    // Depois: paga 165 em 05/11 e conciliada.
    const eventId = await pay();

    b = await budgetOf(w, "2026-11");
    assert.deepEqual([b.spent_cents, b.open_planned_cents, b.committed_cents, b.over], ["16500", "0", "16500", false]);
    report = await readProjection(db, w.user, { today: TODAY, copilot: true });
    assert.equal(itemFlows(report, slot.id).length, 0);
    assert.equal(outTotal(report.flows), 0n);
    assert.equal((await readCopilot(db, w.user, { today: TODAY })).breakdown.bills, 0n);

    // Dia a dia: os 165 saem do ritmo, ficam como conta fixa.
    const u = await usual(w);
    assert.equal(u.usual_weekly_cents, "1000");
    assert.deepEqual(u.excluded.map((g) => [g.excluded, g.total_cents]), [["fixed", "16500"]]);
    assert.deepEqual(u.included.map((g) => g.total_cents), ["8000"]);

    // Mês: o item aparece uma vez, como pago.
    const { items } = await readRoutine(db, w.user, "2026-11");
    assert.deepEqual(
      items.filter((i) => i.label === "Condomínio").map((i) => [i.status, i.paid_cents, i.event_id]),
      [["done", "16500", eventId]],
    );
  } finally {
    await db.close();
  }
});

test("2. conta fixa no cartão (fecha 25, vence 10): uma saída só, na fatura; compra conciliada não soma de novo", async () => {
  const db = await openDatabase();
  try {
    const today = "2026-11-20";
    const w = await setupWorld(db, "card", today);
    const card = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
      [card, w.user.familyId, w.user.userId],
    );
    await saveCardCycle(db, w.user, { account_id: card, close_date: "2026-10-25", due_date: "2026-11-10" }, { today: "2026-10-01" });
    await ceiling(w, "2026-12-01", 20000);
    const series = await fixedBill(w, { label: "Streaming", cents: 12000, start: "2026-11-15", frequency: "year", account: card, today });
    const [slot] = await slotsOf(db, series);
    // Compra de 15/11 fecha na fatura que vence em 10/12.
    assert.deepEqual([slot.month, slot.due], ["2026-12-01", "2026-12-10"]);

    // Prevista: uma única saída de 120, no vencimento da fatura.
    let report = await readProjection(db, w.user, { today, copilot: true });
    assert.deepEqual(
      report.flows.map((f) => [f.key, f.cons.date, f.cons.cents]),
      [["cardplan:2026-12", "2026-12-10", 12000n]],
    );
    let dec = await budgetOf(w, "2026-12");
    assert.deepEqual([dec.spent_cents, dec.open_planned_cents, dec.committed_cents], ["0", "12000", "12000"]);

    // Compra real de 125 conciliada; a fatura de dezembro (125) já a contém.
    const eventId = await spend(w, { account: card, date: "2026-11-15", description: "STREAMING XYZ", cents: 12500, kind: "card_purchase" });
    await reconcile(w, slot, { eventId, cents: 12500, date: "2026-11-15" });
    await db.query(
      "INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by) VALUES($1,$2,'2026-12-01',12500,'2026-12-10',false,$3)",
      [w.user.familyId, card, w.user.userId],
    );
    for (const copilot of [true, false]) {
      report = await readProjection(db, w.user, { today, copilot });
      assert.deepEqual(
        report.flows.map((f) => [f.key, f.cons.date, f.cons.cents]),
        [[`bill:${card}:2026-12`, "2026-12-10", 12500n]],
        `copilot=${copilot}`,
      );
      assert.equal(itemFlows(report, slot.id).length, 0);
    }
    // Mês: a compra pesa em dezembro (vencimento), uma vez; novembro fica sem ela.
    dec = await budgetOf(w, "2026-12");
    assert.deepEqual([dec.spent_cents, dec.open_planned_cents, dec.committed_cents, dec.over], ["12500", "0", "12500", false]);
    assert.equal((await readState(db, w.user, "2026-12-01", "BRL")).summary.expense_cents, "12500");
    assert.equal((await readState(db, w.user, "2026-11-01", "BRL")).summary.expense_cents, "0");
  } finally {
    await db.close();
  }
});

test("2b. conta fixa no cartão em aberto + fatura lida com a compra: saída total 150 no vencimento, não 300", async () => {
  const db = await openDatabase();
  try {
    const today = "2026-11-20";
    const w = await setupWorld(db, "card-open", today);
    const card = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
      [card, w.user.familyId, w.user.userId],
    );
    await saveCardCycle(db, w.user, { account_id: card, close_date: "2026-10-25", due_date: "2026-11-10" }, { today: "2026-10-01" });
    const series = await fixedBill(w, { label: "Streaming", cents: 15000, start: "2026-11-15", frequency: "year", account: card, today });
    const [slot] = await slotsOf(db, series);
    assert.deepEqual([slot.month, slot.due], ["2026-12-01", "2026-12-10"]);

    // Sem fatura lida: a ocorrência aparece uma vez, via cardplan, no vencimento.
    let report = await readProjection(db, w.user, { today, copilot: true });
    assert.deepEqual(
      report.flows.map((f) => [f.key, f.cons.date, f.cons.cents]),
      [["cardplan:2026-12", "2026-12-10", 15000n]],
    );

    // Fatura lida de 150 já traz a compra; o item segue em aberto.
    await db.query(
      "INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by) VALUES($1,$2,'2026-12-01',15000,'2026-12-10',false,$3)",
      [w.user.familyId, card, w.user.userId],
    );
    for (const copilot of [true, false]) {
      report = await readProjection(db, w.user, { today, copilot });
      const dec10 = report.flows.filter((f) => f.cons.date === "2026-12-10");
      assert.equal(outTotal(dec10), 15000n, `copilot=${copilot}`);
      assert.equal(itemFlows(report, slot.id).length, 0);
    }
  } finally {
    await db.close();
  }
});

test("3. semanal de R$180 com 5 ocorrências: comprometido 900; 2 pagas e conciliadas não somam as previstas", async () => {
  const db = await openDatabase();
  try {
    const today = "2026-12-14";
    const w = await setupWorld(db, "weekly", today);
    await ceiling(w, "2026-12-01", 100000);
    const series = await fixedBill(w, { label: "Diarista", cents: 18000, start: "2026-11-05", frequency: "week", today });
    const dec = (await slotsOf(db, series)).filter((s) => s.month === "2026-12-01");
    assert.deepEqual(dec.map((s) => s.date), ["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
    const decFlows = async () => {
      const report = await readProjection(db, w.user, { today });
      return dec.flatMap((s) => itemFlows(report, s.id));
    };

    let b = await budgetOf(w, "2026-12");
    assert.deepEqual([b.spent_cents, b.open_planned_cents, b.committed_cents], ["0", "90000", "90000"]);
    assert.equal(outTotal(await decFlows()), 90000n);

    const first = await spend(w, { date: "2026-12-03", description: "DIARISTA MARIA", cents: 19000 });
    const second = await spend(w, { date: "2026-12-10", description: "DIARISTA MARIA", cents: 17500 });
    await reconcile(w, dec[0], { eventId: first, cents: 19000, date: "2026-12-03" });
    await reconcile(w, dec[1], { eventId: second, cents: 17500, date: "2026-12-10" });

    // 2 reais (365) + 3 previstas (540) = 905, sem as 2 previstas pagas (360).
    b = await budgetOf(w, "2026-12");
    assert.deepEqual([b.spent_cents, b.open_planned_cents, b.committed_cents, b.over], ["36500", "54000", "90500", false]);
    const flows = await decFlows();
    assert.deepEqual(flows.map((f) => f.key).sort(), dec.slice(2).map((s) => `item:${s.id}`).sort());
    assert.equal(outTotal(flows), 54000n);
  } finally {
    await db.close();
  }
});

test("4. teto de R$3.500: criar, editar e encerrar série não mexe em budgets; over quando o comprometido passa", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "ceiling");
    await ceiling(w, "2026-11-01", 350000);
    const rows = await budgetRows(w);
    assert.equal(rows.length, 1);
    const unchanged = async () => assert.deepEqual(await budgetRows(w), rows);

    const rent = await fixedBill(w, { label: "Aluguel", cents: 300000, start: "2026-11-05" });
    await unchanged();
    let b = await budgetOf(w, "2026-11");
    assert.deepEqual([b.planned_cents, b.committed_cents, b.over], ["350000", "300000", false]);

    const extra = await fixedBill(w, { label: "Reforma", cents: 60000, start: "2026-11-20" });
    await unchanged();
    b = await budgetOf(w, "2026-11");
    assert.deepEqual([b.committed_cents, b.over], ["360000", true]);

    const preview = await previewFromDate(db, w.user, { recurrence_id: rent, from: "2026-12-01" });
    await applyFromDate(db, w.user, {
      recurrence_id: rent, from: "2026-12-01", changes: { expected_cents: 310000 }, decisions: {}, versions: versionsOf(preview), today: TODAY,
    });
    await unchanged();
    assert.equal((await budgetOf(w, "2026-11")).committed_cents, "360000");
    // O teto de novembro vale a partir dele: dezembro = 3.100 + 600.
    const decBudget = await budgetOf(w, "2026-12");
    assert.deepEqual([decBudget.ceiling_from, decBudget.committed_cents, decBudget.over], ["2026-11-01", "370000", true]);

    const endPreview = await previewFromDate(db, w.user, { recurrence_id: extra, from: "2026-11-01" });
    await endRecurrence(db, w.user, { recurrence_id: extra, from: "2026-11-01", decisions: {}, versions: versionsOf(endPreview) });
    await unchanged();
    b = await budgetOf(w, "2026-11");
    assert.deepEqual([b.committed_cents, b.over], ["300000", false]);
  } finally {
    await db.close();
  }
});

test("5. salário (renda offset 1): entra uma vez no mês seguinte; detectado sai dos recebimentos previstos", async () => {
  const db = await openDatabase();
  try {
    const today = "2026-11-26";
    const w = await setupWorld(db, "salary", today);
    const { recurrence_id } = await createRecurrence(db, w.user, {
      purpose: "income", label: "Salário", category_id: null, expected_cents: 600000, frequency: "month",
      start_date: "2026-11-25", date_rule: "weekend_to_friday", planning_offset: 1, today,
    });
    const [slot] = (await slotsOf(db, recurrence_id)).filter((s) => s.date === "2026-11-25");
    assert.deepEqual([slot.month, slot.due], ["2026-12-01", null]);
    const occurrence = (
      await db.query<{ id: string }>("SELECT id FROM recurrence_occurrences WHERE monthly_item_id=$1", [slot.id])
    ).rows[0].id;

    // Planejamento: só em dezembro; novembro mostra o recebimento como aviso.
    const named = (m: { items: { label: string }[] }) => m.items.filter((i) => i.label === "Salário").length;
    assert.equal(named(await readRoutine(db, w.user, "2026-12")), 1);
    const nov = await readRoutine(db, w.user, "2026-11");
    assert.equal(named(nov), 0);
    assert.deepEqual(nov.receipts.map((r) => [r.label, r.budget_month]), [["Salário", "2026-12-01"]]);

    // O dinheiro chegou em 25/11 (já no saldo); a ocorrência ainda não casou.
    const salaryCategory = (
      await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Outras receitas'", [w.user.familyId])
    ).rows[0].id;
    await spend(w, { date: "2026-11-25", description: "SALARIO EMPRESA", cents: 600000, kind: "income", category: salaryCategory });
    const incomeFlows = async () =>
      (await readProjection(db, w.user, { today })).flows.filter((f) => f.key === `inc:${occurrence}`);
    assert.deepEqual((await incomeFlows()).map((f) => [f.direction, f.nom.date, f.nom.cents]), [["in", "2026-11-26", 600000n]]);

    await db.query("UPDATE recurrence_occurrences SET match_state='detected' WHERE id=$1", [occurrence]);
    assert.equal((await incomeFlows()).length, 0);
    assert.equal(named(await readRoutine(db, w.user, "2026-12")), 1);

    // Mês: o dinheiro conta uma vez, em novembro (data do lançamento).
    assert.equal((await readState(db, w.user, "2026-11-01", "BRL")).summary.income_cents, "600000");
    assert.equal((await readState(db, w.user, "2026-12-01", "BRL")).summary.income_cents, "0");
  } finally {
    await db.close();
  }
});

test("7. conta avulsa de R$200 em aberto + pagamento de R$200 não conciliado: o Copiloto não desconta 400", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "adhoc");
    await history(w);
    const item = randomUUID();
    await db.query(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,status,created_by)
       VALUES($1,$2,'2026-11-01','Dedetização','expense','BRL',20000,$3,'2026-11-12','open',$4)`,
      [item, w.user.familyId, w.housing, w.user.userId],
    );
    await spend(w, { date: "2026-11-05", description: "DEDETIZADORA SA", cents: 20000 });

    const report = await readProjection(db, w.user, { today: TODAY, copilot: true });
    // Obrigação de 200 uma vez; o pagamento de 200 não vira ritmo.
    assert.equal(outTotal(itemFlows(report, item)), 20000n);
    const u = await usual(w);
    assert.equal(u.usual_weekly_cents, "1000");
    assert.deepEqual(u.excluded.map((g) => [g.excluded, g.total_cents]), [["bill", "20000"]]);
  } finally {
    await db.close();
  }
});

test("6. Panorama: o gasto conciliado à conta fixa aparece uma vez, como fixo, e não como dia a dia", async () => {
  const db = await openDatabase();
  try {
    const w = await setupWorld(db, "panorama");
    const { pay } = await paidCashBill(w);
    let panorama = await readInsights(db, w.user, { today: TODAY });
    // Sem conciliar, os 165 pagos seriam dia a dia.
    assert.deepEqual([panorama.fixed.fixed, panorama.fixed.everyday], [0n, 1000n]);

    await pay();
    panorama = await readInsights(db, w.user, { today: TODAY });
    assert.deepEqual([panorama.fixed.fixed, panorama.fixed.everyday], [16500n, 1000n]);
    // A soma fixo + dia a dia fecha com o gasto do mês por categoria.
    const monthTotal = panorama.categories.month.reduce((s, c) => s + c.cents, 0n);
    assert.equal(panorama.fixed.fixed + panorama.fixed.everyday, monthTotal);
    assert.equal(panorama.categories.month.find((c) => c.name === "Moradia")?.cents, 16500n);
  } finally {
    await db.close();
  }
});
