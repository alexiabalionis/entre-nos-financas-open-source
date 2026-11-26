import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asUser, openDatabase } from "../src/server/db.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { readInsights } from "../src/server/insights.ts";
import { readProjection } from "../src/server/projection.ts";
import { checkItem, saveItem } from "../src/server/routine.ts";
import { spend } from "./no-double-count-helpers.ts";
import { TODAY, bankWorld, realized, stateOf, stateSpent, total } from "./value-contracts-helpers.ts";

// Etapa 1 dos contratos de valores: testes de CARACTERIZAÇÃO. Cada asserção
// registra o que o código faz HOJE. Onde há divergência entre telas, o
// comentário "DIVERGÊNCIA" explica e a asserção guarda o valor atual; a etapa
// de correção só inverte a asserção marcada. Nada aqui altera src/ nem app/.

test("1. linha do banco ligada a uma reserva: fora do consumo no Mês e no leitor compartilhado", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-reserva");
    const line = await w.pending({ local: w.bank, date: "2026-11-06", description: "PIX PARA RESERVA", cents: -30000, group: "expense" });
    // Sem vínculo, as duas leituras concordam.
    assert.equal(await stateSpent(w, "2026-11"), "30000");
    assert.equal(total(await realized(w, "2026-11-01", "2026-12-01")), 30000n);

    const goal = randomUUID();
    await db.query("INSERT INTO goals(id,household_id,name,target_cents,created_by) VALUES($1,$2,'Viagem',100000,$3)", [goal, w.user.familyId, w.user.userId]);
    await db.query(
      "INSERT INTO reserve_movements(id,household_id,goal_id,kind,cents,date,bank_transaction_id,created_by) VALUES($1,$2,$3,'deposit',30000,'2026-11-06',$4,$5)",
      [randomUUID(), w.user.familyId, goal, line, w.user.userId],
    );
    // Reserva nunca é consumo: a linha vinculada fica fora do Mês e do leitor compartilhado.
    assert.equal(await stateSpent(w, "2026-11"), "0");
    assert.equal(total(await realized(w, "2026-11-01", "2026-12-01")), 0n);
  } finally {
    await db.close();
  }
});

test("2. reembolso vinculado em outro mês: abate no mês do estorno no Mês, no leitor compartilhado e no Insights", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-estorno-evento");
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
    // Convenção de produto: o reembolso reduz o consumo no mês em que ocorre, com a categoria da compra.
    assert.equal(await stateSpent(w, "2026-10"), "10000");
    assert.equal(await stateSpent(w, "2026-11"), "-3000");
    assert.equal(total(await realized(w, "2026-10-01", "2026-11-01")), 10000n);
    assert.equal(total(await realized(w, "2026-11-01", "2026-12-01")), -3000n);
    const insights = await readInsights(w.db, w.user, { today: TODAY });
    const out = (m: string) => insights.months.find((x) => x.month === m)!.out;
    assert.equal(out("2026-10"), 10000n);
    assert.equal(out("2026-11"), -3000n);
    assert.deepEqual(insights.categories.month.map((c) => c.cents), [-3000n]);
  } finally {
    await db.close();
  }
});

test("3. estorno de cartão pendente: Mês e leitor compartilhado abatem a compra", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-estorno-pendente");
    await w.pending({ local: w.card, date: "2026-10-25", description: "LOJA TESTE", cents: -12000 });
    await w.pending({ local: w.card, date: "2026-10-26", description: "ESTORNO LOJA TESTE", cents: 4000 });
    // Competência de novembro (fatura que vence em 20/11).
    assert.equal(await stateSpent(w, "2026-10"), "0");
    assert.equal(await stateSpent(w, "2026-11"), "8000");
    // O estorno de cartão pendente abate o consumo, como já abate no Mês.
    assert.equal(total(await realized(w, "2026-10-01", "2026-11-01")), 8000n);
  } finally {
    await db.close();
  }
});

test("4. pagamento manual sem lançamento: o comprometido não conta o que foi marcado como pago", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-manual");
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
    const outflow = async () => {
      const row = (await stateOf(w, "2026-11")).outflow.find((o) => o.category_id === w.market);
      return { spent: row?.spent_cents ?? "0", open: row?.open_planned_cents ?? "0" };
    };
    const check = async (status: "partial" | "done", amount: string, eventId: string | null = null) =>
      checkItem(db, w.user, { id, version: await version(), status, amount, date: "2026-11-03", event_id: eventId });

    assert.deepEqual(await outflow(), { spent: "0", open: "15000" });
    await check("partial", "60,00");
    // Só o restante em aberto conta; os R$ 60 pagos sem lançamento somem.
    assert.deepEqual(await outflow(), { spent: "0", open: "9000" });
    await check("done", "150,00");
    assert.deepEqual(await outflow(), { spent: "0", open: "0" });
    assert.equal(await stateSpent(w, "2026-11"), "0");
    // Com lançamento conciliado, o valor entra pela transação, uma vez.
    const event = await spend(w, { date: "2026-11-03", description: "FEIRA LIVRE", cents: 16500, category: w.market });
    await check("done", "165,00", event);
    assert.deepEqual(await outflow(), { spent: "16500", open: "0" });
  } finally {
    await db.close();
  }
});

test("5. Insights: categorias, dias, fixo/dia a dia e saída mensal fecham no mesmo consumo líquido", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-insights");
    const purchase = await spend(w, { date: "2026-11-05", description: "MERCADO", cents: 5000, category: w.market });
    await w.pending({ local: w.bank, date: "2026-11-06", description: "PIX FEIRA", cents: -3000, group: "expense" });
    await w.pending({ local: w.card, date: "2026-11-08", description: "LOJA CARTAO", cents: -2000 });
    await asUser(db, w.user.userId, (tx) =>
      createManualEventTx(tx, w.user, {
        account_id: w.bank,
        date: "2026-11-09",
        description: "ESTORNO MERCADO",
        amount: "10,00",
        kind: "refund",
        category_id: w.market,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: purchase,
      }),
    );
    const insights = await readInsights(w.db, w.user, { today: TODAY });
    const rows = await realized(w, "2026-11-01", "2026-11-12");
    const categories = insights.categories.month.reduce((s, c) => s + c.cents, 0n);
    const days = insights.days.reduce<bigint>((s, d) => s + (d ?? 0n), 0n);
    // Invariante (a): mesmo universo (readRealizedSpend).
    assert.equal(categories, total(rows));
    assert.equal(days, total(rows));
    assert.equal(insights.fixed.fixed + insights.fixed.everyday, total(rows));
    assert.equal(total(rows), 9000n); // 50 + 30 + 20 - 10 de estorno
    // Invariante (b): a saída mensal é o mesmo consumo líquido; a diferença para os eventos são só as pendências.
    const flowOut = insights.months.find((m) => m.month === "2026-11")!.out;
    const eventsInSpend = total(rows.filter((r) => r.source === "event"));
    assert.equal(flowOut, total(rows));
    assert.equal(eventsInSpend, 4000n);
    assert.equal(total(rows) - eventsInSpend, 5000n); // PIX 30 + cartão 20
  } finally {
    await db.close();
  }
});

test("6. pendência aprovada como evento: o gasto não muda no Mês nem no leitor compartilhado", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-pendente-evento");
    const line = await w.pending({ local: w.bank, date: "2026-11-06", description: "PIX FEIRA", cents: -4000, group: "expense" });
    const before = [await stateSpent(w, "2026-11"), total(await realized(w, "2026-11-01", "2026-12-01"))];
    assert.deepEqual(before, ["4000", 4000n]);
    const event = await spend(w, { date: "2026-11-06", description: "PIX FEIRA", cents: 4000, category: w.market });
    await db.query("UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2", [event, line]);
    const rows = await realized(w, "2026-11-01", "2026-12-01");
    assert.deepEqual([await stateSpent(w, "2026-11"), total(rows)], ["4000", 4000n]);
    assert.deepEqual(rows.map((r) => r.source), ["event"]);
  } finally {
    await db.close();
  }
});

test("7. fatura vencida e não paga: pesa na competência do mês e a projeção a trata como saída de hoje", async () => {
  const db = await openDatabase();
  try {
    const today = "2026-11-21";
    const w = await bankWorld(db, "vc-fatura-vencida", today);
    await w.pending({ local: w.card, date: "2026-10-20", description: "LOJA FATURA", cents: -80000 });
    assert.equal(await stateSpent(w, "2026-11"), "80000");
    assert.equal(await stateSpent(w, "2026-10"), "0");
    await db.query(
      "INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by) VALUES($1,$2,'2026-11-01',80000,'2026-11-20',false,$3)",
      [w.user.familyId, w.card, w.user.userId],
    );
    const report = await readProjection(db, w.user, { today, copilot: true });
    const bills = report.flows.filter((f) => f.key.startsWith("bill:"));
    assert.equal(bills.length, 1);
    assert.equal(bills[0].cons.cents, 80000n);
    // Vencida (20/11 < hoje): o motor derruba o valor em hoje, o dinheiro ainda vai sair.
    assert.equal(report.series[0].day, today);
    assert.equal(report.series[0].cons - report.sConf, -80000n);
  } finally {
    await db.close();
  }
});

test("14. entrada pendente elegível: o Insights soma a mesma entrada que o Mês", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "vc-entrada-pendente");
    await w.pending({ local: w.bank, date: "2026-11-05", description: "CREDITO SALARIO", cents: 500000, group: "income" });
    const state = await stateOf(w, "2026-11");
    const insights = await readInsights(w.db, w.user, { today: TODAY });
    assert.equal(state.summary.income_cents, "500000");
    assert.equal(insights.months.find((m) => m.month === "2026-11")!.in, 500000n);
  } finally {
    await db.close();
  }
});
