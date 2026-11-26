import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asUser, openDatabase } from "../src/server/db.ts";
import { readFuture, toFutureWire } from "../src/server/future-plan.ts";
import { decodeFutureInput, decodeFutureResult } from "../app/future/decode.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { savePlanRange } from "../src/server/reserves.ts";
import { readUsualWeekly } from "../src/server/projection-reads-everyday.ts";
import { fixedBill, reconcile, slotsOf, spend } from "./no-double-count-helpers.ts";
import { TODAY, bankWorld, type Bank } from "./value-contracts-helpers.ts";

// Coletor do Copiloto Futuro: cada número tem origem rastreável e nada é
// contado duas vezes. `today` fixo em 11/11/2026; saldo confirmado de R$ 5.000.

const salary = (w: Bank) =>
  createRecurrence(w.db, w.user, {
    purpose: "income", label: "Salário", expected_cents: 600000, frequency: "month", start_date: "2026-11-05", today: TODAY,
  });
const future = (w: Bank, months = 6) => readFuture(w.db, w.user, { months, today: TODAY });

test("renda e conta fixa de série aparecem uma vez por mês, com e sem item gerado", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-series");
    await salary(w);
    await fixedBill(w, { label: "Aluguel", cents: 100000, start: "2026-11-20", today: TODAY });
    const { input } = await future(w, 6);
    // Novembro a janeiro têm item gerado (sync); fevereiro em diante vêm só da regra.
    assert.deepEqual(input.income.map((m) => [m.month, m.cents]), ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"].map((m) => [m, 600000n]));
    assert.deepEqual(input.fixed.map((m) => [m.month, m.cents]), ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"].map((m) => [m, 100000n]));
    assert.equal(input.startBalance, 500000n);
    assert.equal(input.income[1].items[0].source, "recorrencia");
  } finally {
    await db.close();
  }
});

test("salário planejado para o mês seguinte (offset) entra no Futuro no mês em que cai na conta", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-offset");
    await createRecurrence(w.db, w.user, {
      purpose: "income", label: "Salário", expected_cents: 600000, frequency: "month",
      start_date: "2026-11-25", planning_offset: 1, today: TODAY,
    });
    const { input } = await future(w, 4);
    // A aba Mês planeja o de 25/11 em dezembro; o caixa do Futuro o vê em novembro.
    assert.deepEqual(input.income.map((m) => [m.month, m.cents]), ["2026-11", "2026-12", "2027-01", "2027-02"].map((m) => [m, 600000n]));
  } finally {
    await db.close();
  }
});

test("conta fixa já paga e conciliada no mês corrente não soma de novo", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-paga");
    const series = await fixedBill(w, { label: "Aluguel", cents: 100000, start: "2026-11-20", today: TODAY });
    const [slot] = await slotsOf(db, series);
    const eventId = await spend(w, { date: "2026-11-10", description: "ALUGUEL", cents: 100000 });
    await reconcile(w, slot, { eventId, cents: 100000, date: "2026-11-10" });
    const { input } = await future(w, 3);
    assert.deepEqual(input.fixed.map((m) => m.month), ["2026-12", "2027-01"]);
    // A conta paga continua no mês, separada: só para mostrar o mês inteiro.
    const paidNov = input.paidFixed?.find((m) => m.month === "2026-11");
    assert.deepEqual(paidNov?.items.map((i) => i.cents), [100000n]);
  } finally {
    await db.close();
  }
});

test("item manual do plano entra como plano; o pago ou parcial conta só o restante", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-manual");
    await db.query(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,paid_cents,status,created_by)
       VALUES($1,$2,'2026-12-01','IPTU','expense','BRL',90000,30000,'partial',$3),
             ($4,$2,'2026-12-01','Seguro','expense','BRL',20000,20000,'done',$3)`,
      [randomUUID(), w.user.familyId, w.user.userId, randomUUID()],
    );
    const { input } = await future(w, 3);
    const dec = input.fixed.find((m) => m.month === "2026-12")!;
    assert.deepEqual(dec.items.map((i) => [i.label, i.cents, i.source]), [["IPTU", 60000n, "plano"]]);
    const paid = input.paidFixed?.find((m) => m.month === "2026-12");
    // A consulta não garante ordem: compara ordenado.
    const sorted = paid?.items.map((i) => [i.label, i.cents]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    assert.deepEqual(sorted, [["IPTU", 30000n], ["Seguro", 20000n]]);
  } finally {
    await db.close();
  }
});

test("cartão: parcelas por compra e recorrente somado à estimativa enquanto não aparece lançado", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-cartao");
    // Parcela 2/6 de R$ 200 de uma compra de 25/10 (ciclo: fecha 13, vence 20).
    const line = await w.pending({ local: w.card, date: "2026-11-14", description: "SOFA LOJA TESTE", cents: -20000 });
    await db.query(
      `UPDATE bank_transactions SET card_meta='{"installment_number":2,"total_installments":6,"purchase_date":"2026-10-25"}'::jsonb WHERE id=$1`,
      [line],
    );
    await createRecurrence(w.db, w.user, {
      purpose: "expense", label: "Streaming", category_id: w.market, account_id: w.card,
      expected_cents: 5000, frequency: "month", start_date: "2026-11-15", today: TODAY,
    });
    const { input, result } = await future(w, 6);
    const c = input.cards[0];
    const sofa = c.installments.filter((p) => p.label === "Sofa Loja Teste");
    assert.deepEqual(sofa.map((p) => [p.month, p.k, p.n]), [["2026-12", 2, 6], ["2027-01", 3, 6], ["2027-02", 4, 6], ["2027-03", 5, 6], ["2027-04", 6, 6]]);
    assert.ok(sofa.every((p) => p.lastMonth === "2027-04" && p.cents === 20000n));
    const recurringIn = (m: string) => c.recurring.filter((r) => r.month === m).reduce((s, r) => s + r.cents, 0n);
    const bill = (m: string) => c.bills.find((b) => b.month === m)!;
    // Dezembro tem a parcela lançada, mas a assinatura ainda não apareceu no
    // ciclo: a estimativa soma as duas (antes ficava só a maior).
    assert.equal(bill("2026-12").total, 20000n + recurringIn("2026-12"));
    // De janeiro em diante só há parcela derivada: o recorrente soma.
    assert.equal(bill("2027-01").total, 20000n + recurringIn("2027-01"));
    // As partes sempre fecham com o total do mês.
    for (const row of result.rows)
      for (const part of row.cardParts) assert.equal(part.parts.reduce((s, p) => s + p.cents, 0n), row.card);
    const end = result.milestones.find((m) => m.kind === "installment-end")!;
    assert.deepEqual([end.month, end.title], ["2027-04", "Última parcela: Sofa Loja Teste"]);
    // Parcelas depois do horizonte contam como compromisso: em jan/27 faltam fev, mar e abr.
    const short = await future(w, 3);
    assert.equal(short.result.rows[2].committed, 60000n);
  } finally {
    await db.close();
  }
});

test("recorrente do cartão já lançado no ciclo não soma de novo na estimativa", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-rec-lancado");
    await createRecurrence(w.db, w.user, {
      purpose: "expense", label: "Streaming", category_id: w.market, account_id: w.card,
      expected_cents: 5000, frequency: "month", start_date: "2026-11-15", today: TODAY, match_text: "STREAMING TESTE",
    });
    // O seguro parcelado muda o "05/12" no extrato todo mês: ainda é a mesma cobrança.
    await createRecurrence(w.db, w.user, {
      purpose: "expense", label: "Seguro", category_id: w.market, account_id: w.card,
      expected_cents: 2000, frequency: "month", start_date: "2026-11-15", today: TODAY, match_text: "SEGURO TESTE 05/12",
    });
    // Mesmo ciclo da assinatura (fecha 13, vence 20): as cobranças já vieram do banco.
    await w.pending({ local: w.card, date: "2026-11-15", description: "STREAMING TESTE", cents: -5000 });
    await w.pending({ local: w.card, date: "2026-11-15", description: "SEGURO TESTE 06/12", cents: -2000 });
    await w.pending({ local: w.card, date: "2026-11-16", description: "PADARIA", cents: -3000 });
    const { input } = await future(w, 3);
    const dec = input.cards[0].bills.find((b) => b.month === "2026-12")!;
    assert.equal(dec.total, 10000n, "assinatura e seguro lançados + padaria, sem somar de novo");
  } finally {
    await db.close();
  }
});

test("recorrente do cartão que é parcelamento (11/12) para depois da última parcela; o mês atual só soma o lançado", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-rec-fim");
    await createRecurrence(w.db, w.user, {
      purpose: "expense", label: "Seguro", category_id: w.market, account_id: w.card,
      expected_cents: 2000, frequency: "month", start_date: "2026-10-01", today: TODAY, match_text: "SEGURO TESTE",
    });
    // Ciclo fecha 13, vence 20: a linha de 15/11 é da fatura de dez; 11/12 em dez → 12/12 em jan.
    await w.pending({ local: w.card, date: "2026-11-15", description: "SEGURO TESTE 11/12", cents: -2000 });
    const { input } = await future(w, 5);
    const rec = input.cards[0].recurring.map((r) => r.month);
    assert.ok(rec.includes("2027-01"), "a última parcela (12/12) ainda cobra");
    assert.ok(!rec.some((m) => m > "2027-01"), "depois de 12/12 a série não cobra mais");
    // Mês atual: o seguro de nov não foi lançado nesse ciclo e não é somado.
    const nov = input.cards[0].bills.find((b) => b.month === "2026-11");
    assert.equal(nov?.total ?? 0n, 0n);
  } finally {
    await db.close();
  }
});

test("fatura lida do banco manda; o que já foi pago dela não conta de novo", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-fatura");
    await db.query(
      "INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by) VALUES($1,$2,'2026-12-01',80000,'2026-12-20',false,$3),($1,$2,'2027-01-01',50000,'2027-01-20',true,$3)",
      [w.user.familyId, w.card, w.user.userId],
    );
    const { input } = await future(w, 4);
    const bills = input.cards[0].bills;
    assert.equal(bills.find((b) => b.month === "2026-12")!.total, 80000n);
    assert.equal(bills.find((b) => b.month === "2027-01")!.total, 0n, "fatura marcada como paga não sai de novo");
  } finally {
    await db.close();
  }
});

test("dia a dia: a parcela fica fora do ritmo sem parcelas; o Futuro não projeta o dia a dia", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-diaadia");
    const weeks = ["2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"];
    for (const date of weeks) {
      await spend(w, { date, description: "FEIRA " + date, cents: 1000, category: w.market });
      const id = await w.pending({ local: w.card, date, description: "MOVEIS " + date, cents: -5000 });
      await db.query(`UPDATE bank_transactions SET card_meta='{"installment_number":2,"total_installments":6}'::jsonb WHERE id=$1`, [id]);
    }
    const weekly = (excludeInstallments: boolean) =>
      asUser(db, w.user.userId, (tx) =>
        readUsualWeekly(tx, { familyId: w.user.familyId, today: TODAY, excludeInstallments }),
      );
    assert.equal(await weekly(false), 6000n);
    assert.equal(await weekly(true), 1000n);
    // O Futuro não projeta o dia a dia: a folga é o que sobra para ele.
    const { input } = await future(w, 3);
    assert.deepEqual(input.everyday, { weekly: null, source: "ausente" });
  } finally {
    await db.close();
  }
});

test("reserva na própria conta sai do saldo livre; meta e plano vêm dos objetivos", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-reserva");
    const goal = randomUUID();
    await db.query(
      "INSERT INTO goals(id,household_id,name,target_cents,deadline_month,priority,location,created_by) VALUES($1,$2,'Reserva',1000000,'2027-06-01',1,'same_account',$3)",
      [goal, w.user.familyId, w.user.userId],
    );
    await db.query(
      "INSERT INTO reserve_movements(id,household_id,goal_id,kind,cents,date,created_by) VALUES($1,$2,$3,'deposit',30000,'2026-10-01',$4)",
      [randomUUID(), w.user.familyId, goal, w.user.userId],
    );
    await savePlanRange(w.db, w.user, { goal_id: goal, from_month: "2026-11", months: 2, planned: "500,00" });
    const { input, result } = await future(w, 4);
    assert.equal(input.startBalance, 500000n - 30000n);
    const g = input.goals[0];
    assert.deepEqual([g.saved, g.target, g.deadlineMonth, g.location], [30000n, 1000000n, "2027-06", "same_account"]);
    assert.deepEqual(g.plans.map((p) => [p.month, p.planned]), [["2026-11", 50000n], ["2026-12", 50000n]]);
    // O aporte repete o último plano conhecido nos meses seguintes.
    assert.equal(result.rows[3].goalIn[goal], 50000n);
  } finally {
    await db.close();
  }
});

test("isolamento: outra família não vê renda, contas nem objetivos desta", async () => {
  const db = await openDatabase();
  try {
    const a = await bankWorld(db, "fc-iso-a");
    const b = await bankWorld(db, "fc-iso-b");
    await salary(a);
    await fixedBill(a, { label: "Aluguel", cents: 100000, start: "2026-11-20", today: TODAY });
    const other = await future(b, 4);
    assert.deepEqual([other.input.income, other.input.fixed], [[], []]);
    assert.ok(other.input.goals.every((g) => g.name !== "Aluguel"));
    assert.ok((await future(a, 4)).input.income.length > 0);
  } finally {
    await db.close();
  }
});

test("meses fora de 3 a 36 são recusados e o fio traz centavos como texto", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-limites");
    await assert.rejects(() => readFuture(w.db, w.user, { months: 2, today: TODAY }), /entre 3 e 36/);
    await assert.rejects(() => readFuture(w.db, w.user, { months: 37, today: TODAY }), /entre 3 e 36/);
    const wire = toFutureWire(await future(w, 3));
    assert.equal(wire.input.startBalance, "500000");
    assert.equal(typeof wire.result.rows[0].free, "string");
  } finally {
    await db.close();
  }
});

test("salvar como plano: substitui os vigentes, preserva o histórico, audita por mês e bloqueia leitor", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-plano");
    const goal = randomUUID();
    await db.query("INSERT INTO goals(id,household_id,name,target_cents,created_by) VALUES($1,$2,'Viagem',400000,$3)", [goal, w.user.familyId, w.user.userId]);
    const first = await savePlanRange(w.db, w.user, { goal_id: goal, from_month: "2026-12", months: 3, planned: "100,00" });
    assert.equal(first.ids.length, 3);
    const second = await savePlanRange(w.db, w.user, { goal_id: goal, from_month: "2027-01", months: 2, planned: "0,00" });
    assert.equal(second.ids.length, 2);
    const current = (
      await db.query<{ month: string; planned_cents: string }>(
        "SELECT to_char(month,'YYYY-MM') AS month,planned_cents::text FROM reserve_plans WHERE goal_id=$1 AND superseded_by IS NULL ORDER BY month",
        [goal],
      )
    ).rows;
    assert.deepEqual(current.map((p) => [p.month, p.planned_cents]), [["2026-12", "10000"], ["2027-01", "0"], ["2027-02", "0"]]);
    const all = (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM reserve_plans WHERE goal_id=$1", [goal])).rows[0].n;
    assert.equal(all, "5", "substituir nunca apaga: 3 do primeiro e 2 do segundo");
    const audits = (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE household_id=$1 AND action='reserve.plan'", [w.user.familyId])).rows[0].n;
    assert.equal(audits, "5");
    const reader = { ...w.user, role: "reader" } as typeof w.user;
    await assert.rejects(() => savePlanRange(w.db, reader, { goal_id: goal, from_month: "2027-03", months: 1, planned: "10,00" }), /só de leitura/);
    for (const bad of [{ months: 0 }, { months: 37 }, { planned: "-5,00" }]) {
      await assert.rejects(() => savePlanRange(w.db, w.user, { goal_id: goal, from_month: "2027-03", months: 1, planned: "10,00", ...bad }));
    }
  } finally {
    await db.close();
  }
});

test("ocorrência cancelada (item arquivado) não volta pela regra da série", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-cancelada");
    const series = await fixedBill(w, { label: "Aluguel", cents: 100000, start: "2026-11-20", today: TODAY });
    const dec = (await slotsOf(db, series)).find((s) => s.month === "2026-12-01")!;
    await db.query("UPDATE monthly_items SET archived=true WHERE id=$1", [dec.id]);
    const { input } = await future(w, 4);
    assert.deepEqual(input.fixed.map((m) => m.month), ["2026-11", "2027-01", "2027-02"]);
  } finally {
    await db.close();
  }
});

test("objetivo sem local conhecido vira premissa", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-local");
    const goal = randomUUID();
    await db.query("INSERT INTO goals(id,household_id,name,target_cents,created_by) VALUES($1,$2,'Viagem',400000,$3)", [goal, w.user.familyId, w.user.userId]);
    await db.query("INSERT INTO reserve_movements(id,household_id,goal_id,kind,cents,date,created_by) VALUES($1,$2,$3,'deposit',10000,'2026-10-01',$4)", [randomUUID(), w.user.familyId, goal, w.user.userId]);
    const { input } = await future(w, 3);
    assert.ok(input.premises!.some((p) => p.includes("Não sabemos onde está")));
    assert.equal(input.startBalance, 500000n);
  } finally {
    await db.close();
  }
});

test("o fio do servidor decodifica de volta para o mesmo input e resultado (contrato com a tela)", async () => {
  const db = await openDatabase();
  try {
    const w = await bankWorld(db, "fc-fio");
    await salary(w);
    await fixedBill(w, { label: "Aluguel", cents: 100000, start: "2026-11-20", today: TODAY });
    const goal = randomUUID();
    await db.query("INSERT INTO goals(id,household_id,name,target_cents,created_by) VALUES($1,$2,'Viagem',400000,$3)", [goal, w.user.familyId, w.user.userId]);
    await savePlanRange(w.db, w.user, { goal_id: goal, from_month: "2026-11", months: 3, planned: "100,00" });
    const read = await future(w, 12);
    const wire = JSON.parse(JSON.stringify(toFutureWire(read)));
    assert.deepEqual(decodeFutureInput(wire.input), read.input);
    assert.deepEqual(decodeFutureResult(wire.result), read.result);
  } finally {
    await db.close();
  }
});
