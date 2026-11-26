import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { fifthBusinessDay, incomeDate } from "../src/domain/bank-analysis.ts";
import { asUser, openDatabase } from "../src/server/db.ts";
import { saoPauloToday } from "../src/server/recurrence-sync.ts";
import { runIncomeMigration } from "../src/server/income-migration.ts";
import { verifyIncome } from "../src/server/income-migration-verify.ts";
import { moveIncomeToLegacy } from "./income-seed.ts";
import { readIncomeFlags } from "../src/server/copilot-reads.ts";
import { readReceipts } from "../src/server/projection-reads-plan.ts";
import { ensureFirstGoal, listGoals, savePlan } from "../src/server/reserves.ts";
import { checkItem, copyMonth, readRoutine, saveItem } from "../src/server/routine.ts";
import {
  addCredit,
  analyze,
  find,
  incomeItem,
  incomeItems,
  makeWorld,
  pick,
  saveRule,
  snap,
  type World,
} from "./income-baseline-helpers.ts";

// Baseline (etapa 3a): fixa o comportamento das entradas recorrentes. Desde a etapa 3c os
// testes rodam sobre o núcleo (recurrences + recurrence_occurrences); só D1 e D2 diferem.
// Spec: docs/SPEC-RECORRENCIAS.md 6.3 e 7.1. As regras começam em 2026-01 e a
// geração vai até "hoje + 2 meses", então os meses de 2026 sempre existem.

let db: PGlite;
before(async () => {
  db = await openDatabase();
});
after(async () => {
  await db.close();
});

const PLANNED_NOTE = "Previsão de recebimento; ainda não identificado no banco.";
const DETECTED_NOTE =
  "Crédito identificado no banco; aguarda sua revisão. Nenhum lançamento confirmado.";
const DIVERGENT_NOTE = "Data, valor ou situação divergem da regra: confira no banco.";
const MANY_NOTE =
  "Mais de um crédito compatível: escolha o recebimento correto.";
const WISE_NOTE =
  "Crédito via Wise candidato ao salário. Confira a origem do trabalho e o valor convertido; nem todo Pix Wise é salário.";

const withoutItemId = (funding: object | undefined) =>
  Object.fromEntries(
    Object.entries(funding ?? {}).filter(([k]) => k !== "monthly_item_id"),
  );

const salaryItem = async (w: World, month: string) =>
  incomeItem(w, month, "Salário");

test("1. dia fixo: antecipa sábado e domingo para sexta; budget_offset 0 e 1, inclusive dezembro para janeiro", async () => {
  const w = await makeWorld(db, "calendario");
  await saveRule(w, { label: "Salário A", match_text: "EMPREGADOR A", budget_offset: 1 });
  await saveRule(w, { label: "Salário B", match_text: "EMPREGADOR B", budget_offset: 0 });
  const rows = await snap(w);
  // Não retroage: a primeira ocorrência é o mês de início da regra.
  assert.equal(rows.filter((r) => r.rule_label === "Salário A")[0].pay_month, "2026-01");
  const cases: [string, string][] = [
    ["2026-07", "2026-07-24"], // 25/07 é sábado
    ["2026-10", "2026-10-23"], // 25/10 é domingo
    ["2026-11", "2026-11-25"], // quarta
    ["2026-12", "2026-12-25"], // sexta
  ];
  for (const [pay, expected] of cases) {
    assert.equal(incomeDate(pay), expected);
    const a = pick(rows, pay, "Salário A");
    const b = pick(rows, pay, "Salário B");
    assert.equal(a.expected_date, expected);
    assert.equal(b.expected_date, expected);
    assert.equal(a.state, "planned");
    assert.equal(a.note, PLANNED_NOTE);
    assert.equal(b.budget_month, pay + "-01");
  }
  assert.equal(pick(rows, "2026-07", "Salário A").budget_month, "2026-08-01");
  assert.equal(pick(rows, "2026-10", "Salário A").budget_month, "2026-11-01");
  // dezembro financia janeiro do ano seguinte com offset 1.
  const dec = pick(rows, "2026-12", "Salário A");
  assert.equal(dec.budget_month, "2027-01-01");
  assert.deepEqual(dec.item, {
    id: dec.item?.id,
    month: "2027-01-01",
    label: "Salário A",
    planned_cents: "800000",
    status: "open",
  });
  assert.equal(pick(rows, "2026-12", "Salário B").item?.month, "2026-12-01");
  // Textos do item criado pela regra.
  const jan = await incomeItem(w, "2027-01", "Salário A");
  assert.equal(
    jan.notes,
    "Previsão: recebimento no mês anterior. Não representa receita confirmada.",
  );
  assert.equal(
    jan.source_note,
    "Regra familiar: dia 25, antecipado para sexta no fim de semana; financia o mês seguinte.",
  );
  const same = await incomeItem(w, "2026-12", "Salário B");
  assert.equal(
    same.notes,
    "Previsão variável no mesmo mês. Não representa receita confirmada.",
  );
  // SURPRESA: o source_note fala "financia o mês seguinte" mesmo com offset 0.
  assert.equal(
    same.source_note,
    "Regra familiar: dia 25, antecipado para sexta no fim de semana; financia o mês seguinte.",
  );
});

test("2. business_window: quinto dia útil; crédito Wise é candidato e nunca vira detected; Wise não vale para regra fixa", async () => {
  const w = await makeWorld(db, "janela");
  await saveRule(w, {
    label: "Trabalho variável",
    match_text: "EMPRESA TRABALHO",
    receipt_mode: "business_window",
    budget_offset: 0,
    expected_cents: "650000",
  });
  await saveRule(w, { label: "Salário fixo", match_text: "EMPREGADOR TESTE" });
  const wise = await addCredit(w, {
    date: "2026-03-10",
    cents: 650000,
    description: "WISE PIX RECEBIDO",
  });
  // Texto da regra + data e valor exatos: ainda assim a janela nunca dá detected.
  await addCredit(w, {
    date: fifthBusinessDay("2026-04"),
    cents: 650000,
    description: "EMPRESA TRABALHO",
  });
  await addCredit(w, { date: "2026-05-12", cents: 100000, description: "WIZE TRANSFER" });
  await analyze(w);
  const rows = await snap(w);
  assert.equal(pick(rows, "2026-03", "Trabalho variável").expected_date, "2026-03-06");
  assert.equal(fifthBusinessDay("2026-03"), "2026-03-06");
  assert.equal(pick(rows, "2026-11", "Trabalho variável").expected_date, "2026-11-06");
  const march = pick(rows, "2026-03", "Trabalho variável");
  assert.equal(march.state, "review");
  assert.equal(march.bank_transaction_id, wise);
  assert.equal(march.note, WISE_NOTE);
  assert.equal(march.budget_month, "2026-03-01");
  const april = pick(rows, "2026-04", "Trabalho variável");
  assert.equal(april.expected_date, "2026-04-07");
  assert.equal(april.state, "review");
  assert.equal(april.note, WISE_NOTE); // SURPRESA: nota de Wise mesmo sem Wise
  assert.equal(pick(rows, "2026-05", "Trabalho variável").state, "review");
  assert.equal(pick(rows, "2026-06", "Trabalho variável").state, "planned");
  assert.equal(
    pick(rows, "2026-06", "Trabalho variável").note,
    "Janela aproximada de cinco dias de semana; feriados podem alterar a estimativa. Data e valor precisam de revisão.",
  );
  const item = await incomeItem(w, "2026-11", "Trabalho variável");
  assert.equal(
    item.source_note,
    "Janela esperada: cinco primeiros dias úteis, sem data ou valor garantidos; feriados podem alterar a estimativa. Financia o mesmo mês.",
  );
  // A regra fixa não aceita Wise como candidato.
  for (const m of ["2026-03", "2026-05"]) {
    const fixed = pick(rows, m, "Salário fixo");
    assert.equal(fixed.state, "planned");
    assert.equal(fixed.bank_transaction_id, null);
  }
});

test("3. detecção: detected só com data e valor iguais e transação postada, fixa e inalterada", async () => {
  const w = await makeWorld(db, "deteccao");
  await saveRule(w);
  const exact = (m: string) => incomeDate(m);
  const ok = await addCredit(w, { date: exact("2026-01"), cents: 800000 });
  await addCredit(w, { date: "2026-02-20", cents: 800000 }); // data diferente
  await addCredit(w, { date: exact("2026-03"), cents: 800001 }); // valor diferente
  await addCredit(w, { date: exact("2026-04"), cents: 800000 });
  await addCredit(w, { date: exact("2026-04"), cents: 800000 }); // dois créditos
  // maio: nenhum crédito
  await addCredit(w, { date: exact("2026-06"), cents: 800000, providerStatus: "PENDING" });
  await addCredit(w, { date: exact("2026-07"), cents: 800000, changed: true });
  await addCredit(w, { date: exact("2026-08"), cents: 800000, missing: true });
  await addCredit(w, { date: exact("2026-09"), cents: -800000 }); // débito é ignorado
  await analyze(w);
  const rows = await snap(w);
  const detected = pick(rows, "2026-01");
  assert.equal(detected.state, "detected");
  assert.equal(detected.note, DETECTED_NOTE);
  assert.equal(detected.bank_transaction_id, ok);
  for (const m of ["2026-02", "2026-03"]) {
    const r = pick(rows, m);
    assert.equal(r.state, "review");
    assert.equal(r.note, DIVERGENT_NOTE);
    assert.notEqual(r.bank_transaction_id, null);
  }
  const many = pick(rows, "2026-04");
  assert.equal(many.state, "review");
  assert.equal(many.note, MANY_NOTE);
  assert.equal(many.bank_transaction_id, null);
  const none = pick(rows, "2026-05");
  assert.equal(none.state, "planned");
  assert.equal(none.note, PLANNED_NOTE);
  assert.equal(none.bank_transaction_id, null);
  for (const m of ["2026-07", "2026-08"]) {
    const r = pick(rows, m);
    assert.equal(r.state, "review", m + " alterada/ausente nunca detected");
    assert.equal(r.note, DIVERGENT_NOTE);
  }
  // PENDING com data passada já saiu da conta: conta como confirmado.
  assert.equal(pick(rows, "2026-06").state, "detected");
  assert.equal(pick(rows, "2026-09").state, "planned");
  // Nada é confirmado: o item segue aberto.
  assert.equal(detected.item?.status, "open");
});

test("4. recebimento parcial: item vira partial pela conferência e a ocorrência continua review", async () => {
  const w = await makeWorld(db, "parcial");
  await saveRule(w);
  await addCredit(w, { date: incomeDate("2026-03"), cents: 700000 });
  await analyze(w);
  assert.equal(pick(await snap(w), "2026-03").state, "review");
  const item = await salaryItem(w, "2026-04");
  await checkItem(w.db, w.u, {
    id: item.id,
    version: item.version,
    status: "partial",
    amount: "7000,00",
    date: "2026-03-25",
  });
  await analyze(w);
  const row = pick(await snap(w), "2026-03");
  assert.equal(row.state, "review");
  assert.equal(row.item?.status, "partial");
  const after = await salaryItem(w, "2026-04");
  assert.equal(after.status, "partial");
  assert.equal(after.paid_cents, "700000");
  assert.equal(after.funding?.state, "review");
  assert.equal(after.event_id, null);
});

test("5. reaproveita item de mesmo nome (sem diferenciar maiúsculas); dois de mesmo nome não são tocados", async () => {
  const w = await makeWorld(db, "reuso");
  const insert = (month: string, label: string, cents: number) =>
    asUser(db, w.u.userId, (tx) =>
      tx.query(
        `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,created_by) VALUES(gen_random_uuid(),$1,$2,$3,'income','BRL',$4,$5)`,
        [w.u.familyId, month + "-01", label, cents, w.u.userId],
      ),
    );
  await insert("2026-04", "salário", 123456); // reaproveitado (pagamento em março)
  await insert("2026-05", "Salário", 111); // duplicados (pagamento em abril)
  await insert("2026-05", "Salário", 222);
  await saveRule(w);
  const rows = await snap(w);
  const reused = pick(rows, "2026-03");
  assert.equal(reused.item?.label, "salário");
  assert.equal(reused.item?.planned_cents, "123456");
  assert.equal((await incomeItems(w, "2026-04")).length, 1);
  // Ambíguo: nenhuma ocorrência criada e nenhum terceiro item.
  assert.equal(find(rows, "2026-04"), undefined);
  const may = await incomeItems(w, "2026-05");
  assert.deepEqual(may.map((i) => i.planned_cents).sort(), ["111", "222"]);
  // Os outros meses recebem item novo com o valor da regra.
  assert.equal(pick(rows, "2026-02").item?.planned_cents, "800000");
});

test("6. valor editado no item sobrevive a nova leitura dos bancos", async () => {
  const w = await makeWorld(db, "edicao");
  await saveRule(w);
  const before = await salaryItem(w, "2026-04");
  await saveItem(w.db, w.u, {
    id: before.id,
    version: before.version,
    month: "2026-04",
    label: before.label,
    purpose: "income",
    currency: "BRL",
    amount: "9000,00",
    due_date: null,
    notes: before.notes,
  });
  await analyze(w);
  await analyze(w);
  const items = await incomeItems(w, "2026-04");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, before.id);
  assert.equal(items[0].planned_cents, "900000");
  const row = pick(await snap(w), "2026-03");
  assert.equal(row.item?.id, before.id);
  assert.equal(row.item?.planned_cents, "900000");
});

test("7. Mês: card 'para o próximo mês' (receipts) e funding dos itens, com textos e valores", async () => {
  const w = await makeWorld(db, "cartao");
  await saveRule(w);
  await saveRule(w, { label: "Extra", match_text: "EXTRA TESTE", budget_offset: 0 });
  const credit = await addCredit(w, { date: "2026-03-25", cents: 800000 });
  await analyze(w);
  const march = await readRoutine(w.db, w.u, "2026-03");
  assert.deepEqual(
    march.receipts.filter((r) => r.label === "Salário"),
    [
      {
        label: "Salário",
        expected_date: "2026-03-25",
        received_date: "2026-03-25",
        budget_month: "2026-04-01",
        state: "detected",
        note: DETECTED_NOTE,
        amount_cents: "800000",
      },
    ],
  );
  // Regra com offset 0 financia o próprio mês: não entra no card.
  assert.equal(march.receipts.filter((r) => r.label === "Extra").length, 0);
  const april = await readRoutine(w.db, w.u, "2026-04");
  assert.deepEqual(
    april.receipts.filter((r) => r.label === "Salário"),
    [
      {
        label: "Salário",
        expected_date: "2026-04-24",
        received_date: null,
        budget_month: "2026-05-01",
        state: "planned",
        note: PLANNED_NOTE,
        amount_cents: null,
      },
    ],
  );
  // Funding no item do mês financiado (abril é financiado pelo pagamento de março).
  const funded = april.items.find((i) => i.label === "Salário");
  // O funding também carrega monthly_item_id (o próprio item).
  assert.equal(
    (funded?.funding as { monthly_item_id?: string } | undefined)?.monthly_item_id,
    funded?.id,
  );
  assert.deepEqual(withoutItemId(funded?.funding), {
    receipt_mode: "fixed",
    expected_date: "2026-03-25",
    received_date: "2026-03-25",
    state: "detected",
    note: DETECTED_NOTE,
    bank_transaction_id: credit,
  });
  const planned = march.items.find((i) => i.label === "Salário");
  assert.deepEqual(withoutItemId(planned?.funding), {
    receipt_mode: "fixed",
    expected_date: "2026-02-25",
    received_date: null,
    state: "planned",
    note: PLANNED_NOTE,
    bank_transaction_id: null,
  });
  const extra = march.items.find((i) => i.label === "Extra");
  assert.equal(extra?.funding?.expected_date, "2026-03-25");
  assert.equal(extra?.planned_cents, "800000");
});

async function detectedWorld(tag: string) {
  const w = await makeWorld(db, tag);
  await saveRule(w, { effective_month: "2026-09" });
  await addCredit(w, { date: "2026-09-25", cents: 800000 });
  await analyze(w);
  return w;
}
const flags = (w: World, today: string) =>
  asUser(db, w.u.userId, (tx) =>
    readIncomeFlags(tx, { familyId: w.u.familyId, today }),
  );
const receipts = (w: World, today: string) =>
  asUser(db, w.u.userId, (tx) => readReceipts(tx, w.u.familyId, today));

test("8a. Copiloto: incomeDetected e receiptLate", async () => {
  const w = await detectedWorld("flags");
  const rows = await snap(w);
  assert.equal(pick(rows, "2026-09").state, "detected");
  assert.deepEqual(await flags(w, "2026-09-28"), {
    incomeDetected: true,
    receiptLate: null,
  });
  // Outubro previsto para 23/10 e não chegou: atrasado só a partir da data.
  assert.deepEqual(await flags(w, "2026-10-22"), {
    incomeDetected: false,
    receiptLate: null,
  });
  assert.deepEqual(await flags(w, "2026-10-28"), {
    incomeDetected: false,
    receiptLate: { id: pick(rows, "2026-10").occurrence_id, expectedDate: "2026-10-23" },
  });
  // O atraso mais antigo ganha.
  const late = await flags(w, "2026-12-30");
  assert.equal(late.receiptLate?.expectedDate, "2026-10-23");
});

test("8b. projeção: recebimentos previstos ignoram detectados e começam 7 dias antes de hoje; janela fecha +2 dias", async () => {
  const w = await detectedWorld("projecao");
  await saveRule(w, {
    label: "Trabalho variável",
    match_text: "EMPRESA TRABALHO",
    receipt_mode: "business_window",
    budget_offset: 0,
    expected_cents: "650000",
    effective_month: "2026-09",
  });
  const on = await receipts(w, "2026-10-30"); // limite: 30/10 - 7 dias = 23/10
  const salary = on.filter((r) => r.cents === 800000n);
  assert.equal(salary.some((r) => r.expected === "2026-09-25"), false);
  const oct = salary.find((r) => r.expected === "2026-10-23");
  assert.deepEqual(oct && { ...oct, id: "" }, {
    id: "",
    cents: 800000n,
    expected: "2026-10-23",
    windowEnd: null,
    detected: false,
  });
  assert.equal(salary.some((r) => r.expected === "2026-11-25"), true);
  const window = on.find((r) => r.cents === 650000n && r.expected === "2026-11-06");
  assert.equal(window?.windowEnd, "2026-11-08");
  const off = await receipts(w, "2026-10-31");
  assert.equal(off.some((r) => r.expected === "2026-10-23"), false);
  assert.equal(off.some((r) => r.detected), false);
});

test("9. copyMonth não copia a entrada prevista de regra que ainda não chegou", async () => {
  const w = await makeWorld(db, "copia");
  await saveRule(w);
  const planned = await salaryItem(w, "2026-04");
  await saveItem(w.db, w.u, {
    id: planned.id,
    version: planned.version,
    month: "2026-04",
    label: "Salário",
    purpose: "income",
    currency: "BRL",
    amount: "7000,00",
    due_date: null,
    notes: planned.notes,
  });
  await saveItem(w.db, w.u, {
    month: "2026-04",
    label: "Aluguel",
    purpose: "expense",
    currency: "BRL",
    amount: "1500,00",
    due_date: "2026-04-10",
  });
  const target = await incomeItem(w, "2026-05");
  const result = await copyMonth(w.db, w.u, { from: "2026-04", to: "2026-05" });
  // SURPRESA: o contador inclui o item pulado.
  assert.deepEqual(result, { copied: 2 });
  const items = (await readRoutine(w.db, w.u, "2026-05")).items;
  const salary = items.filter((i) => i.label === "Salário");
  assert.equal(salary.length, 1);
  assert.equal(salary[0].id, target.id);
  assert.equal(salary[0].planned_cents, "800000");
  const rent = items.find((i) => i.label === "Aluguel");
  assert.equal(rent?.planned_cents, "150000");
  assert.equal(rent?.due_date, "2026-05-10");
});

test("10. reserve_plans.occurrence_id nunca é gravado", async () => {
  const w = await makeWorld(db, "reserva");
  await saveRule(w);
  await asUser(db, w.u.userId, (tx) => ensureFirstGoal(tx, { user: w.u }));
  const [goal] = await listGoals(w.db, w.u);
  const first = await savePlan(w.db, w.u, { goal_id: goal.id, month: "2026-11", planned: "100,00" });
  await savePlan(w.db, w.u, {
    goal_id: goal.id,
    month: "2026-11",
    planned: "150,00",
    version_of: first.id,
  });
  assert.ok((await snap(w)).length > 0);
  const plans = (
    await db.query<{ occurrence_id: string | null }>(
      "SELECT occurrence_id FROM reserve_plans WHERE household_id=$1",
      [w.u.familyId],
    )
  ).rows;
  assert.equal(plans.length, 2);
  assert.deepEqual(
    plans.map((p) => p.occurrence_id),
    [null, null],
  );
});

test("11. regra pausada some de receipts, funding, projeção e Copiloto, e volta ao reativar", async () => {
  const w = await detectedWorld("pausa");
  const oct = pick(await snap(w), "2026-10");
  const visible = async () => ({
    receipts: (await readRoutine(w.db, w.u, "2026-09")).receipts.length,
    funding: (await salaryItem(w, "2026-10")).funding?.state ?? null,
    projection: (await receipts(w, "2026-10-28")).some((r) => r.expected === "2026-10-23"),
    late: (await flags(w, "2026-10-28")).receiptLate?.expectedDate ?? null,
  });
  assert.deepEqual(await visible(), {
    receipts: 1,
    funding: "detected",
    projection: true,
    late: "2026-10-23",
  });
  await saveRule(w, { effective_month: "2026-09", enabled: false });
  assert.deepEqual(await visible(), {
    receipts: 0,
    funding: null,
    projection: false,
    late: null,
  });
    // As ocorrências continuam gravadas; só as leituras filtram a pausa.
  assert.equal(pick(await snap(w), "2026-10").occurrence_id, oct.occurrence_id);
  // DIVERGÊNCIA DA SPEC 7.1.11: incomeDetected NÃO filtra r.enabled.
  assert.equal((await flags(w, "2026-09-28")).incomeDetected, true);
  await saveRule(w, { effective_month: "2026-09", enabled: true });
  assert.deepEqual(await visible(), {
    receipts: 1,
    funding: "detected",
    projection: true,
    late: "2026-10-23",
  });
  assert.equal(pick(await snap(w), "2026-10").occurrence_id, oct.occurrence_id);
});

test("11b. regra criada pausada não gera ocorrências", async () => {
  const w = await makeWorld(db, "pausada");
  await saveRule(w, { enabled: false });
  assert.equal((await snap(w)).length, 0);
  assert.equal((await incomeItems(w, "2026-04")).length, 0);
  await saveRule(w, { enabled: true });
  assert.ok((await snap(w)).length > 0);
});

test("D1: editar o dia da regra vale do mês atual em diante e deixa o passado intacto", async () => {
  const w = await makeWorld(db, "d1");
  await saveRule(w);
  await addCredit(w, { date: "2026-03-25", cents: 800000 });
  await analyze(w);
  const before = pick(await snap(w), "2026-03");
  assert.equal(before.expected_date, "2026-03-25");
  assert.equal(before.state, "detected");
  await saveRule(w, { day: 10 });
  const rows = await snap(w);
  // Março já passou: data prevista, estado e nota continuam como estavam.
  const march = pick(rows, "2026-03");
  assert.equal(march.occurrence_id, before.occurrence_id);
  assert.equal(march.expected_date, "2026-03-25");
  assert.equal(march.state, "detected");
  assert.equal(march.note, DETECTED_NOTE);
  assert.equal(pick(rows, "2026-01").expected_date, "2026-01-23"); // 25/01 é domingo
  // Do mês atual em diante vale o dia novo, sem duplicar a previsão.
  const current = saoPauloToday().slice(0, 7);
  assert.equal(pick(rows, current).expected_date, incomeDate(current, 10));
  assert.equal(rows.filter((r) => r.pay_month === current).length, 1);
  assert.equal((await incomeItems(w, "2026-04")).length, 1);
});

test("D2: renomear o item de um mês não cria um segundo item na próxima leitura", async () => {
  const w = await makeWorld(db, "d2");
  await saveRule(w);
  const item = await salaryItem(w, "2026-04");
  await saveItem(w.db, w.u, {
    id: item.id,
    version: item.version,
    month: "2026-04",
    label: "Salário renomeado",
    purpose: "income",
    currency: "BRL",
    amount: "8000,00",
    due_date: null,
    notes: item.notes,
  });
  await analyze(w);
  const items = await incomeItems(w, "2026-04");
  assert.deepEqual(items.map((i) => i.label), ["Salário renomeado"]);
  // A ocorrência continua ligada ao item renomeado.
  const row = pick(await snap(w), "2026-03");
  assert.equal(row.item?.id, item.id);
  assert.equal(row.item?.label, "Salário renomeado");
  // Estável: uma nova leitura também não cria nada.
  await analyze(w);
  assert.equal((await incomeItems(w, "2026-04")).length, 1);
});

test("dia 1 ou 2 em fim de semana: antecipa a data, mas o mês segue o mês do pagamento + offset", async () => {
  const w = await makeWorld(db, "fim-de-semana");
  await saveRule(w, { label: "Dia 1 off 0", match_text: "D1O0", day: 1, budget_offset: 0 });
  await saveRule(w, { label: "Dia 1 off 1", match_text: "D1O1", day: 1, budget_offset: 1 });
  await saveRule(w, { label: "Dia 2 off 0", match_text: "D2O0", day: 2, budget_offset: 0 });
  await saveRule(w, { label: "Dia 2 off 1", match_text: "D2O1", day: 2, budget_offset: 1 });
  const rows = await snap(w);
  // 2026-08-01 é sábado e 2026-08-02 é domingo: ambos antecipam para sexta, 2026-07-31.
  const d1o0 = pick(rows, "2026-08", "Dia 1 off 0");
  assert.equal(d1o0.expected_date, "2026-07-31");
  assert.equal(d1o0.item?.month, "2026-08-01");
  assert.equal(pick(rows, "2026-08", "Dia 1 off 1").item?.month, "2026-09-01");
  const d2o0 = pick(rows, "2026-08", "Dia 2 off 0");
  assert.equal(d2o0.expected_date, "2026-07-31");
  assert.equal(d2o0.item?.month, "2026-08-01");
  assert.equal(pick(rows, "2026-08", "Dia 2 off 1").item?.month, "2026-09-01");
  await moveIncomeToLegacy(w.db, w.u.familyId);
  const report = await runIncomeMigration(w.db, w.u, { apply: true });
  assert.equal(report.ok, true, JSON.stringify(report.divergences));
  const check = await asUser(w.db, w.u.userId, (tx) => verifyIncome(tx, w.u.familyId));
  assert.deepEqual(check, { ok: true, divergences: [] });
});
