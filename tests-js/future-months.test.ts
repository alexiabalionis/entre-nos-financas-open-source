import { test } from "node:test";
import { briefingInput } from "../app/future/fixtures.ts";
import assert from "node:assert/strict";
import {
  applyScenario,
  compareFuture,
  describeScenario,
  neededMonthly,
  projectFuture,
  type CardFuture,
  type FutureInput,
  type GoalFuture,
  type MonthAmount,
} from "../src/domain/future-months.ts";
import { cardPurchaseSchedule, simulate } from "../src/domain/projection-simulate.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";

// Cenário do briefing do Copiloto Futuro, em centavos: entrada de R$ 6.000,
// essenciais R$ 2.400, contas fixas R$ 700 e pagamentos de dívida R$ 700 (as
// dívidas ainda não existem no modelo: entram aqui como conta fixa). O cartão
// tem parcelas que terminam e uma compra de fim de ano em jan/27.
const START = "2026-12";
const MONTHS = 24;
const month = (i: number) => shiftMonth(START, i);

const monthly = (label: string, cents: bigint, source: "recorrencia" | "estimado" = "recorrencia"): MonthAmount[] =>
  Array.from({ length: MONTHS }, (_, i) => ({
    month: month(i),
    cents,
    items: [{ key: label, label, cents, source }],
  }));

const CYCLE = { closing_day: 13, due_day: 20, due_month_offset: 0 as const, valid_from: "2026-01-01", valid_until: null };

function card(): CardFuture {
  const bills = Array.from({ length: MONTHS }, (_, i) => {
    const total = i === 0 ? 130000n : i === 1 ? 185000n : i === 2 ? 130000n : i <= 6 ? 114000n : 88000n;
    return { month: month(i), total, quality: "estimated" as const, source: "estimado" as const };
  });
  const gel = Array.from({ length: 7 }, (_, i) => ({
    key: "gel", label: "Geladeira", cents: 26000n, k: 4 + i, n: 10, month: month(i), lastMonth: month(6),
  }));
  const oculos = Array.from({ length: 3 }, (_, i) => ({
    key: "oculos", label: "Óculos", cents: 16000n, k: 4 + i, n: 6, month: month(i), lastMonth: month(2),
  }));
  return { card: "c1", name: "Cartão", cycles: [CYCLE], bills, installments: [...gel, ...oculos], recurring: [] };
}

const reserva: GoalFuture = {
  id: "reserva", name: "Reserva", status: "active", location: "elsewhere",
  target: 1000000n, saved: 230000n, deadlineMonth: null, priority: 1,
  plans: [{ month: START, planned: 50000n }],
};
const viagem: GoalFuture = {
  id: "viagem", name: "Viagem", status: "active", location: "elsewhere",
  target: 400000n, saved: 90000n, deadlineMonth: "2027-12", priority: 2,
  plans: [],
};

function input(over: Partial<FutureInput> = {}): FutureInput {
  return {
    today: "2026-12-01",
    startMonth: START,
    months: MONTHS,
    startBalance: 410000n,
    snapshotDate: "2026-12-01",
    income: monthly("Salário", 600000n),
    fixed: [...monthly("Essenciais", 240000n), ...monthly("Contas fixas", 70000n), ...monthly("Dívidas", 70000n)],
    everyday: { weekly: null, source: "ausente" },
    cards: [card()],
    goals: [reserva, viagem],
    essentialsMonthly: 240000n,
    ...over,
  };
}

test("cenário do briefing: reserva completa em mar/2028, viagem não chega, só jan/27 sem folga", () => {
  const r = projectFuture(input());
  assert.equal(r.reach.reserva, "2028-03");
  assert.equal(r.rows[1].free, -15000n);
  assert.deepEqual(r.conflicts.map((c) => c.month), ["2027-01"]);
  const reached = r.milestones.find((m) => m.id === "reach-reserva")!;
  assert.equal(reached.month, "2028-03");
  assert.match(reached.why[0], /Faltavam R\$ 7\.700/);
  assert.match(reached.why[1], /16 aportes de R\$ 500/);
  const due = r.milestones.find((m) => m.id === "due-viagem")!;
  assert.equal(due.missed, true);
  const compete = r.decisions.find((d) => d.id === "compete-viagem")!;
  // O mês corrente não conta: R$ 3.100 em 12 aportes (jan/27 a dez/27) = R$ 259, começando no mês seguinte.
  assert.equal(compete.action!.scenario.contributions![0].cents, 25900n);
  assert.equal(compete.action!.scenario.contributions![0].fromMonth, shiftMonth(START, 1));
  // O que decide é o mês mais apertado até a data (jan/27), não só o atual.
  assert.match(compete.impact, /Não cabe em jan\/27/);
  assert.equal(r.viability.level, "apertado");
});

test("déficit sai do saldo em conta e nunca da reserva", () => {
  const r = projectFuture(input());
  assert.equal(r.rows[1].bank, 410000n - 15000n);
  assert.equal(r.rows[1].goalBal.reserva, 230000n + 100000n); // dez e jan: aporte cheio mesmo no mês apertado
  assert.equal(r.rows[1].reserves, 330000n + 90000n);
});

test("aporte não passa da meta, para depois de atingida e repete o último plano", () => {
  const r = projectFuture(input());
  const last = r.rows.find((x) => x.month === "2028-03")!;
  assert.equal(last.goalIn.reserva, 20000n);
  assert.equal(last.goalBal.reserva, 1000000n);
  assert.equal(r.rows.find((x) => x.month === "2028-04")?.goalIn.reserva ?? 0n, 0n);
  // plano de fevereiro de 2027 em diante com 100 por mês repete até o fim
  const changed = projectFuture(
    input({ goals: [{ ...reserva, plans: [{ month: START, planned: 50000n }, { month: "2027-02", planned: 10000n }] }, viagem] }),
  );
  assert.equal(changed.rows[2].goalIn.reserva, 10000n);
  assert.equal(changed.rows[10].goalIn.reserva, 10000n);
});

test("plano zero é pausa e objetivo pausado não recebe", () => {
  const paused = projectFuture(input({ goals: [{ ...reserva, status: "paused" }, viagem] }));
  assert.equal(paused.rows[3].goalIn.reserva, 0n);
  assert.equal(paused.reach.reserva, null);
  const zero = projectFuture(input({ goals: [{ ...reserva, plans: [{ month: START, planned: 50000n }, { month: "2027-03", planned: 0n }] }, viagem] }));
  assert.equal(zero.rows[5].goalIn.reserva, 0n);
});

test("valor liberado por parcela que termina vai para os objetivos por prioridade, sem passar da meta", () => {
  const folga = projectFuture(input());
  const objetivos = projectFuture(input({ freedTo: "objetivos" }));
  // óculos termina em fev/27: a partir de mar/27, R$ 160 por mês vão para a reserva
  const mar = objetivos.rows.find((r) => r.month === "2027-03")!;
  const marBase = folga.rows.find((r) => r.month === "2027-03")!;
  assert.equal(mar.goalIn.reserva - marBase.goalIn.reserva, 16000n);
  assert.equal(mar.free, marBase.free - 16000n);
  assert.ok(objetivos.reach.reserva! < folga.reach.reserva!);
  for (const row of objetivos.rows) assert.ok(row.goalBal.reserva <= reserva.target);
});

test("soma das partes da fatura fecha com o total do mês, com e sem total oficial", () => {
  const withBank = card();
  withBank.bills = withBank.bills.map((b, i) => (i === 0 ? { ...b, source: "banco" as const } : b));
  withBank.recurring = [{ key: "rec", label: "Assinaturas", cents: 12000n, month: month(0) }];
  const r = projectFuture(input({ cards: [withBank] }));
  for (const row of r.rows)
    for (const c of row.cardParts) assert.equal(c.parts.reduce((s, p) => s + p.cents, 0n), row.card);
  const parts = r.rows[0].cardParts[0].parts;
  assert.equal(parts.find((p) => p.kind === "fatura")!.cents, 130000n - 26000n - 16000n - 12000n);
  assert.deepEqual(parts.filter((p) => p.kind === "parcela").map((p) => [p.k, p.n]), [[4, 10], [4, 6]]);
});

test("parcelas pagas além do total viram 'já pago' e a soma continua fechando", () => {
  const c = card();
  c.bills = c.bills.map((b, i) => (i === 0 ? { ...b, total: 20000n } : b));
  const r = projectFuture(input({ cards: [c] }));
  const parts = r.rows[0].cardParts[0].parts;
  assert.equal(parts.reduce((s, p) => s + p.cents, 0n), r.rows[0].card);
  assert.equal(parts.at(-1)!.label, "Já pago nesta fatura");
});

test("compra simulada gera as mesmas parcelas e meses do simulador de compra", () => {
  const base = input();
  const purchase = { card: "c1", cents: 100000n, installments: 4, day: "2026-12-05", label: "TV" };
  const applied = applyScenario(base, { purchases: [purchase] });
  const sim = simulate(
    { today: "2026-12-01", horizonEnd: "2028-12-31", cushion: 0n, sConf: 0n, flows: [] },
    { cents: purchase.cents, day: purchase.day, method: "card", installments: 4, cycles: [CYCLE] },
  );
  const schedule = cardPurchaseSchedule({ cents: purchase.cents, day: purchase.day, installments: 4, cycles: [CYCLE] });
  assert.deepEqual(
    schedule.map((p) => [p.dueMonth, p.cents]),
    sim.byMonth.map((m) => [m.month, m.cents]),
  );
  const added = applied.cards[0].installments.filter((p) => p.key === "sim:0");
  assert.deepEqual(added.map((p) => [p.month, p.cents]), schedule.map((p) => [p.dueMonth, p.cents]));
  const before = projectFuture(base);
  const after = projectFuture(applied);
  for (const p of schedule) {
    const i = after.rows.findIndex((r) => r.month === p.dueMonth);
    assert.equal(after.rows[i].card - before.rows[i].card, p.cents);
  }
  assert.equal(base.cards[0].bills.length, MONTHS, "entrada original intacta");
});

test("compra simulada sem ciclo é ignorada com premissa, sem derrubar a projeção", () => {
  const noCycle = input({ cards: [{ ...card(), cycles: [] }] });
  const out = projectFuture(applyScenario(noCycle, { purchases: [{ card: "c1", cents: 1000n, installments: 2, day: "2026-12-05" }] }));
  assert.ok(out.premises.some((p) => p.startsWith("Compra simulada ignorada")));
});

test("cenário de aporte e pausa muda a data de chegada; comparação e descrição dizem como", () => {
  const base = input();
  const scenario = {
    contributions: [{ goalId: "viagem", fromMonth: START, months: null, cents: 23900n }],
    pauses: [{ goalId: "reserva", fromMonth: "2027-02", months: 3 }],
  };
  const a = projectFuture(base);
  const b = projectFuture(applyScenario(base, scenario));
  assert.equal(b.reach.viagem, "2027-12");
  assert.equal(b.rows[2].goalIn.reserva, 0n);
  assert.equal(b.rows[5].goalIn.reserva, 50000n); // volta ao plano depois da pausa
  const diff = compareFuture(a, b, 24, { viagem: "Viagem", reserva: "Reserva" });
  assert.equal(diff.find((d) => d.id === "g-viagem")!.delta, "passa a acontecer");
  const reserve = diff.find((d) => d.id === "g-reserva")!;
  assert.equal(reserve.delta, "+3 meses");
  assert.equal(reserve.sense, -1);
  assert.deepEqual(describeScenario(base, scenario), [
    "Viagem: aporte de R$ 239/mês a partir de dez/26",
    "Reserva: pausa de fev/27 a abr/27",
  ]);
});

test("imprevisto e dia a dia semanal entram no mês e o objetivo novo é simulado", () => {
  const base = input({ everyday: { weekly: 70000n, source: "declarado" } });
  const r = projectFuture(base);
  // dezembro: 31 dias − 1 + 1 = 31 dias; 700 × 31 / 7 = 3100
  assert.equal(r.rows[0].preCard, 600000n - 380000n - 310000n);
  const shock = projectFuture(
    applyScenario(base, { shocks: [{ kind: "despesa", month: "2027-03", months: 1, cents: 150000n, label: "Imprevisto" }] }),
  );
  assert.equal(shock.rows[3].shocks, 150000n);
  assert.ok(shock.conflicts.some((c) => c.month === "2027-03" && c.cause === "Imprevisto"));
  const goal = applyScenario(base, { newGoals: [{ id: "n", name: "Carro", target: 500000n, saved: 0n, deadlineMonth: null, monthly: 10000n }] });
  assert.equal(goal.goals.length, 3);
  assert.equal(projectFuture(goal).rows[0].goalIn.n, 10000n);
});

test("sem dia a dia a projeção diz que a folga é o que sobra para ele; mesma entrada dá a mesma saída", () => {
  const r = projectFuture(input());
  assert.ok(r.premises.some((p) => p.startsWith("O dia a dia não entra na conta")));
  assert.deepEqual(projectFuture(input()), r);
});

test("valor mensal necessário arredonda para cima ao real", () => {
  assert.equal(neededMonthly(400000n, 90000n, 13), 23900n);
  assert.equal(neededMonthly(1000n, 1000n, 3), 0n);
});

test("aporte acima da verba típica é inviável mesmo quando o mês 0, incompleto, ainda sobra", () => {
  // 20/12: o mês 0 só tem 12 dias de dia a dia, então a folga dele engana.
  const r = projectFuture(
    input({
      today: "2026-12-20",
      cards: [],
      fixed: monthly("Fixas", 400000n),
      everyday: { weekly: 20000n, source: "declarado" },
      goals: [{ ...reserva, plans: [{ month: START, planned: 140000n }] }],
    }),
  );
  assert.ok(r.rows[0].free > 0n, "o mês 0 parece caber");
  assert.equal(r.viability.level, "inviavel");
  assert.ok(r.decisions.some((d) => d.id === "over"));
});

test("projeção exige pelo menos um mês", () => {
  assert.throws(() => projectFuture(input({ months: 0 })), /pelo menos 1 mês/);
});

test("objetivo com data cabe quando todos os meses até lá têm folga para o aporte", () => {
  const r = projectFuture(input({ income: monthly("Salário", 700000n) }));
  const compete = r.decisions.find((d) => d.id === "compete-viagem")!;
  assert.match(compete.title, /precisa de R\$ [0-9.]+ por mês para fechar em/);
  assert.equal(compete.tone, "info");
});

test("cobertura da reserva fala em porcentagem de um mês, nunca em 0,00 mês", () => {
  const r = projectFuture(input());
  const cover = r.decisions.find((d) => d.id === "cover");
  if (cover) assert.doesNotMatch(cover.calc, /0,00/);
});

test("dia a dia do mês: fecha em opening + folga, entradas e contas no dia certo e o ponto mais baixo", () => {
  const base = input();
  const dated: FutureInput = {
    ...base,
    income: base.income.map((m) => ({ ...m, items: m.items.map((l) => ({ ...l, date: `${m.month}-25` })) })),
    fixed: [{ month: START, cents: 120000n, items: [{ key: "aluguel", label: "Aluguel", cents: 120000n, source: "recorrencia", date: `${START}-01` }] }],
  };
  const r = projectFuture(dated);
  for (const row of r.rows) assert.equal(row.cash.closing, row.cash.opening + row.free, row.month);
  const dez = r.rows[0].cash;
  // Hoje é 2026-12-?: o aluguel do dia 1 não fica antes de hoje; o salário entra no 25.
  const salary = dez.events.find((e) => e.kind === "entrada")!;
  assert.equal(salary.date, `${START}-25`);
  const rent = dez.events.find((e) => e.label === "Aluguel")!;
  assert.ok(rent.date >= dez.from);
  // O ponto mais baixo é antes do salário (as saídas vêm antes, o salário só no 25).
  assert.ok(dez.low.date < `${START}-25`);
  assert.ok(dez.low.cents <= dez.opening);
});

test("dia a dia do mês: sem data, entrada e conta caem no primeiro dia (sem aperto inventado)", () => {
  const r = projectFuture(input());
  const jan = r.rows[1].cash;
  assert.equal(jan.from, "2027-01-01");
  assert.equal(jan.events.find((e) => e.kind === "entrada")!.date, "2027-01-01");
});

test("dia a dia do mês: o que sobra num mês abre o seguinte", () => {
  const r = projectFuture(input());
  for (let i = 1; i < r.rows.length; i++) assert.equal(r.rows[i].cash.opening, r.rows[i - 1].cash.closing, r.rows[i].month);
  assert.equal(r.rows[0].cash.opening, input().startBalance);
});

test("dia a dia no cartão: sai da conta no vencimento da fatura do mês seguinte, não no dia da compra", () => {
  const base = input({ everyday: { weekly: 70000n, source: "medido", cardShareBp: 6000 } });
  const r = projectFuture(base);
  const [dez, jan] = [r.rows[0].cash, r.rows[1].cash];
  assert.ok(dez.everydayOnCard > 0n);
  assert.equal(dez.events.some((e) => e.label.endsWith("compras do dia a dia do mês passado")), false);
  const paid = jan.events.find((e) => e.label.endsWith("compras do dia a dia do mês passado"))!;
  assert.equal(paid.cents, -dez.everydayOnCard);
  assert.equal(paid.date, "2027-01-20"); // vencimento do ciclo (dia 20)
  // A folga do mês não muda: a compra conta no mês em que é feita.
  assert.equal(r.rows[0].free, projectFuture(input({ everyday: { weekly: 70000n, source: "medido" } })).rows[0].free);
  for (let i = 0; i < r.rows.length; i++) {
    const prev = i ? r.rows[i - 1].cash.everydayOnCard : 0n;
    assert.equal(r.rows[i].cash.closing, r.rows[i].cash.opening + r.rows[i].free + r.rows[i].cash.everydayOnCard - prev);
  }
});

test("sinais de categoria: teto passado vence 'subindo'; abaixo da régua do Panorama não vira aviso", () => {
  const base = input();
  const r = projectFuture({
    ...base,
    signals: {
      categories: [
        { name: "Mercado", cents: 90000n, prev: 40000n, budget: 80000n }, // teto passado (e também subindo)
        { name: "Pet", cents: 30000n, prev: 20000n, budget: null }, // +R$ 100 e +50%: subindo
        { name: "Lazer", cents: 23000n, prev: 20000n, budget: null }, // +R$ 30: fora da régua
      ],
    },
  });
  const ids = r.decisions.map((d) => d.id);
  assert.ok(ids.includes("budget-Mercado"));
  assert.ok(!ids.includes("rise-Mercado"), "uma sugestão por categoria");
  assert.ok(ids.includes("rise-Pet"));
  assert.ok(!ids.some((id) => id.endsWith("-Lazer")));
  const over = r.decisions.find((d) => d.id === "budget-Mercado")!;
  assert.equal(over.metric, 10000n);
  assert.equal(over.action, undefined, "aviso sem simulação: o dia a dia não é projetado");
  assert.ok(over.link?.href.includes(START));
});

test("reserva: a sugestão padrão é o máximo que cabe, em múltiplos de R$ 50, sem passar do que falta", () => {
  // Essenciais altos: a reserva fica bem longe de um mês, então há o que sugerir.
  // Mais R$ 5.000 de entrada por mês: todo mês tem folga, então há espaço para aportar.
  const b0 = briefingInput();
  const base = {
    ...b0,
    essentialsMonthly: b0.essentialsMonthly + 1_000_000n,
    income: b0.income.map((m) => ({
      ...m,
      cents: m.cents + 500_000n,
      items: [...m.items, { key: "extra", label: "Extra", cents: 500_000n, source: "recorrencia" as const }],
    })),
  };
  const r = projectFuture(base);
  const cover = r.decisions.find((d) => d.id === "cover")!;
  assert.ok(r.rows.every((row) => row.free > 0n), "o cenário do teste tem folga em todo mês");
  assert.ok(cover.edit, "com folga e falta grande, há sugestão de aporte");
  assert.equal(cover.edit!.kind, "contribution");
  if (cover.edit!.kind !== "contribution") return;
  assert.equal(cover.edit.cents % 5000n, 0n);
  assert.ok(cover.metric !== undefined && cover.edit.cents <= cover.metric);
  // Com o aporte sugerido, nenhum mês fica com folga negativa por causa dele.
  const after = projectFuture(applyScenario(base, cover.action!.scenario));
  assert.ok(after.rows.every((row) => row.free >= 0n || r.rows.find((b) => b.month === row.month)!.free < 0n));
});

test("goalEdits: nova meta e data valem antes do aporte; o aporte completa a meta nova", () => {
  const b0 = briefingInput();
  const g = b0.goals[0];
  const target = g.saved + 600_000n; // faltam R$ 6.000
  const edited = applyScenario(b0, {
    goalEdits: [{ goalId: g.id, target, deadlineMonth: b0.startMonth }],
    contributions: [{ goalId: g.id, fromMonth: b0.startMonth, months: 6, cents: 100_000n }],
  });
  const goal = edited.goals.find((x) => x.id === g.id)!;
  assert.equal(goal.target, target);
  assert.equal(goal.deadlineMonth, b0.startMonth);
  // R$ 1.000/mês por 6 meses completa R$ 6.000: chega no sexto mês, não antes.
  const r = projectFuture(edited);
  const months = r.rows.map((row) => row.month);
  assert.equal(r.reach[g.id], months[5]);
});

test("contributionMonths: o mês corrente não conta; prazo por dia só conta o mês se for o último dia", async () => {
  const { contributionMonths, lastCountedMonth } = await import("../src/domain/future-months.ts");
  // 19/11/2026, "até dezembro": só dezembro (1 aporte), nunca novembro.
  assert.equal(contributionMonths("2026-11", "2026-12"), 1);
  assert.equal(contributionMonths("2026-11", "2026-12-31"), 1);
  assert.equal(contributionMonths("2026-11", "2026-12-15"), 0, "15/12: dezembro não termina a tempo");
  assert.equal(contributionMonths("2026-11", "2026-11"), 0);
  assert.equal(contributionMonths("2026-11", "2027-07"), 8);
  assert.equal(lastCountedMonth("2027-02-28"), "2027-02");
  assert.equal(lastCountedMonth("2028-02-28"), "2028-01", "2028 é bissexto: 28/02 não é o último dia");
});
