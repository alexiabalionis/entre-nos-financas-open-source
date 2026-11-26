import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScenario, compareFuture, projectFuture } from "../src/domain/future-months.ts";
import { briefingInput, emptyInput } from "../app/future/fixtures.ts";
import {
  billChange,
  contributionChange,
  draftSummary,
  neededForDeadline,
  plannedMonthly,
  reachText,
  cardBars,
  cardMonthLines,
  cardShare,
  cardSummary,
  diffRows,
  everydayPatch,
  ghostTotals,
  installmentLabel,
  minFree,
  monthlyFromWeekly,
  purchaseDayOptions,
  weeklyFromMonthly,
  goalLanes,
  headline,
  cashTimeline,
  milestonesByMonth,
  monthCalc,
  railItems,
} from "../app/future/view-model.ts";

const input = briefingInput();
const result = projectFuture(input);

test("goalLanes: a reserva termina em mar/28 (índice 15); a viagem não completa", () => {
  const lanes = goalLanes(input, result, 24);
  assert.deepEqual(lanes.map((l) => l.key), ["reserva", "viagem"]);
  assert.equal(lanes[0].end, 15);
  assert.equal(lanes[0].endLabel, "R$ 10.000 em mar/28");
  assert.equal(lanes[0].label, "Reserva de emergência");
  assert.equal(lanes[1].end, null);
  assert.equal(lanes[1].endLabel, "sem aporte planejado"); // viagem sem plano: o motivo, não só o efeito
  assert.equal(goalLanes(input, result, 12)[0].end, null, "fora do horizonte curto");
  assert.equal(goalLanes(input, result, 24, true)[0].endLabel, "•••• em mar/28");
});

test("railItems: folga negativa é danger, marco de meta é ok; hidden esconde valores", () => {
  const items = railItems(input, result, 12);
  assert.equal(items.length, 12);
  assert.equal(items[0].label, "dez/26");
  assert.equal(items[1].label, "jan/27");
  assert.equal(items[1].tone, "danger");
  assert.equal(items[1].caption, "faltam R$ 150");
  assert.equal(railItems(input, result, 24)[15].tone, "ok");
  assert.equal(railItems(input, result, 12, true)[1].caption, "faltam ••••");
  const marks = milestonesByMonth(input, result, 24);
  assert.equal(items[1].marks, marks.get(1)?.length ?? 0);
  assert.ok(marks.get(15)?.some((m) => m.kind === "goal-reached"));
});

test("monthCalc: jan/27 tem folga de −R$ 150 e a soma das linhas bate", () => {
  const { lines, total } = monthCalc(input, result, 1);
  assert.equal(total.label, "Folga do mês");
  assert.equal(total.value, -150);
  assert.deepEqual(lines.map((l) => l.label), [
    "Entrada",
    "Contas fixas",
    "Fatura do cartão",
    "Para Reserva de emergência",
  ]);
  assert.equal(lines.reduce((s, l) => s + l.value, 0), -150);
  assert.equal(lines[2].value, -1850);
});

test("monthCalc: fecha em todos os meses, com imprevisto e com valor liberado indo aos objetivos", () => {
  const draft = applyScenario(input, {
    shocks: [{ kind: "despesa", month: "2027-03", months: 1, cents: 50000n, label: "Conserto" }],
    everydayWeekly: 20000n,
    freedTo: "objetivos",
  });
  const r = projectFuture(draft);
  r.rows.forEach((row, i) => {
    const { lines, total } = monthCalc(draft, r, i);
    assert.equal(lines.reduce((s, l) => s + l.value, 0), total.value, row.month);
  });
  const mar = monthCalc(draft, r, 3);
  assert.ok(mar.lines.some((l) => l.label === "Imprevistos" && l.value === -500));
  assert.ok(mar.lines.some((l) => l.label === "Dia a dia (média)" && l.estimate === true));
});

test("monthCalc: índice fora da projeção lança", () => {
  assert.throws(() => monthCalc(input, result, 99), RangeError);
});

test("cardBars: totais por coluna 1.300 (dez), 1.850 (jan) e 880 (jul/27)", () => {
  const bars = cardBars(input, result, 24);
  const total = (i: number) => bars.values[i].reduce((s, v) => s + v, 0);
  assert.equal(total(0), 1300);
  assert.equal(total(1), 1850);
  assert.equal(total(7), 880);
  assert.equal(bars.columns[0], "dez");
  assert.equal(bars.columnLabels[1], "janeiro de 2027: fatura de R$ 1.850");
  // Parcelas/recorrentes sem categoria viram sua própria camada ("Sem
  // categoria"), quebrada visualmente da fatura; Pet e Lazer vêm do resto
  // categorizado (leftoverCategories) da fatura de dezembro. Na legenda,
  // porém, essa quebra desaparece: uma linha só, "Demais categorias".
  assert.deepEqual(bars.layers.map((l) => l.label), ["Pet", "Lazer", "Sem categoria", "Outras compras, fatura em aberto"]);
  assert.deepEqual(bars.legend.map((l) => l.label), ["Pet", "Lazer", "Demais categorias", "Outras compras, fatura em aberto"]);
  assert.equal(bars.layers[3].estimate, true);
  assert.equal(bars.values[0].length, bars.layers.length);
  // Óculos termina em fev/27: a fatura cai R$ 160 em mar/27 (índice 3); Geladeira em jun/27: cai R$ 260 em jul/27.
  assert.equal(bars.footnotes[3], "−R$ 160");
  assert.equal(bars.footnotes[7], "−R$ 260");
  assert.equal(bars.footnotes[0], null);
  assert.equal(bars.footnotes[2], null);
  assert.equal(cardBars(input, result, 6).columns.length, 6);
  assert.equal(cardBars(input, result, 24, true).columnLabels[1], "janeiro de 2027: fatura de ••••");
  // Tooltip: rótulo e valor exato por camada — cada pedaço de "Demais" já é a
  // própria categoria, então o tooltip dela é igual ao de qualquer outra.
  assert.equal(bars.tooltips[0][0], "Pet: R$ 50");
  assert.equal(bars.tooltips[0][1], "Lazer: R$ 30");
  assert.equal(bars.tooltips[0][2], "Sem categoria: R$ 650");
});

test("cardBars: 'Demais categorias' quebra em uma camada por categoria real, mas vira uma linha só na legenda", () => {
  const draft = briefingInput();
  const bill0 = draft.cards[0].bills[0];
  // Pet, Lazer, Farmácia, Presentes e Papelaria somam as 5 nomeadas (teto de
  // MAX_CATEGORY_LAYERS); Correios e Estacionamento, mais "Sem categoria" (das
  // parcelas sem categoria do exemplo), ficam pequenas demais e caem em "Demais".
  bill0.leftoverCategories = [
    { name: "Pet", cents: 5000n },
    { name: "Lazer", cents: 3000n },
    { name: "Farmácia", cents: 2000n },
    { name: "Presentes", cents: 1800n },
    { name: "Papelaria", cents: 1600n },
    { name: "Correios", cents: 700n },
    { name: "Estacionamento", cents: 600n },
  ];
  const r = projectFuture(draft);
  const bars = cardBars(draft, r, 24);
  // Nas barras, cada uma das 3 que caíram em "Demais" é sua própria camada
  // (visível e com tooltip próprio), ordenadas da maior pra menor entre si.
  assert.deepEqual(bars.layers.map((l) => l.label).slice(5, 8), ["Sem categoria", "Correios", "Estacionamento"]);
  assert.equal(bars.tooltips[0][5], "Sem categoria: R$ 650");
  assert.equal(bars.tooltips[0][6], "Correios: R$ 7");
  assert.equal(bars.tooltips[0][7], "Estacionamento: R$ 6");
  // Na legenda, as 3 viram uma linha só, entre as nomeadas e o resto não categorizado.
  assert.deepEqual(bars.legend.map((l) => l.label), [
    "Pet", "Lazer", "Farmácia", "Presentes", "Papelaria", "Demais categorias", "Outras compras, fatura em aberto",
  ]);
});

test("cardMonthLines: parcelas e estimativa com a nota certa", () => {
  const lines = cardMonthLines(result, 0);
  const geladeira = lines.find((l) => l.label === "Geladeira");
  assert.equal(geladeira?.note, "parcela 4/10 · última em jun/27");
  const est = lines.find((l) => l.estimate);
  assert.equal(est?.note, "compras já lançadas nesta fatura");
  assert.equal(lines.reduce((s, l) => s + l.value, 0), 1300);
  assert.deepEqual(cardMonthLines(result, 99), []);
});

test("headline: cai na regra 1 (jan/27 falta R$ 150) e esconde o valor", () => {
  assert.deepEqual(headline(input, result, 24), {
    lead: "Em jan/27 falta R$ 150.",
    detail: "A diferença sai do saldo em conta. Veja o que dá para ajustar.",
  });
  assert.equal(headline(input, result, 24, true).lead, "Em jan/27 falta ••••.");
});

test("headline: sem mês negativo, regra 2 (objetivo completa) e regra 3", () => {
  // Horizonte de 1 mês: dez/26 tem folga; a reserva não completa -> regra 3.
  const short = headline(input, result, 1);
  assert.equal(short.lead, "Nenhum objetivo completa no próximo mês.");
  assert.equal(short.detail, result.viability.detail);
  // Aporte extra em jan/27 tira o vermelho; a reserva completa antes -> regra 2.
  const fixed = applyScenario(input, {
    contributions: [{ goalId: "reserva", fromMonth: "2027-01", months: 1, cents: 35000n }],
  });
  const r = projectFuture(fixed);
  assert.ok(r.rows.every((row) => row.free >= 0n));
  const h = headline(fixed, r, 24);
  assert.match(h.lead, /^Reserva de emergência completa em .+ de 20\d\d\.$/);
  assert.equal(h.detail, "Mantendo R$ 500/mês, como no plano.");
});

test("diffRows: mapeamento 1:1", () => {
  const draft = projectFuture(
    applyScenario(input, { contributions: [{ goalId: "reserva", fromMonth: "2026-12", months: null, cents: 70000n }] }),
  );
  const diff = compareFuture(result, draft, 24, { reserva: "Reserva de emergência" });
  const rows = diffRows(diff);
  assert.equal(rows.length, diff.length);
  assert.ok(rows.length > 0);
  rows.forEach((row, i) => {
    assert.equal(row.key, diff[i].id);
    assert.equal(row.label, diff[i].label);
    assert.equal(row.before, diff[i].before);
    assert.equal(row.after, diff[i].after);
    assert.equal(row.sense, diff[i].sense);
    assert.equal(row.delta, diff[i].delta);
  });
});

test("entrada vazia: nada lança e as listas vêm vazias", () => {
  const empty = emptyInput();
  const r = projectFuture(empty);
  assert.deepEqual(goalLanes(empty, r, 12), []);
  assert.equal(railItems(empty, r, 12).length, 12);
  assert.equal(milestonesByMonth(empty, r, 12).size, 0);
  const calc = monthCalc(empty, r, 0);
  assert.equal(calc.total.value, 0);
  assert.deepEqual(calc.lines.map((l) => l.label), ["Entrada", "Contas fixas", "Fatura do cartão"]);
  const bars = cardBars(empty, r, 12);
  assert.deepEqual(bars.layers, []);
  assert.equal(bars.values.length, 12);
  assert.ok(bars.values.every((v) => v.length === 0));
  assert.deepEqual(cardMonthLines(r, 0), []);
  assert.equal(headline(empty, r, 12).lead, "Nenhum objetivo completa nos próximos 12 meses.");
  assert.deepEqual(diffRows([]), []);
});

test("cardSummary: 1.300 em dez/26, caindo para 880 em jul/27; sem queda no horizonte curto", () => {
  const s = cardSummary(result, 24);
  assert.deepEqual(s, { first: "R$ 1.300", firstMonth: "dez/26", low: { value: "R$ 880", month: "jul/27" } });
  assert.equal(cardSummary(result, 3)?.low, null);
  assert.equal(cardSummary(result, 24, true)?.first, "••••");
  assert.equal(cardSummary(projectFuture(emptyInput()), 0), null);
});

test("billChange: variação sobre o mês anterior; nada no primeiro mês", () => {
  assert.equal(billChange(result, 0), null);
  assert.equal(billChange(result, 1), "+R$ 550 sobre dez/26");
  assert.equal(billChange(result, 7), "−R$ 260 sobre jun/27");
  assert.equal(billChange(result, 1, true), "•••• sobre dez/26");
  assert.equal(billChange(result, 99), null);
});

test("cardShare: o que sobra, o que a fatura leva e o que fica", () => {
  assert.equal(
    cardShare(result, 1),
    "Antes do cartão sobram R$ 2.200. A fatura leva R$ 1.850, ficam R$ 350 para objetivos e folga.",
  );
});

test("ghostTotals: só as colunas em que o rascunho difere do plano salvo", () => {
  assert.ok(ghostTotals(result, result, 24).every((g) => g === null));
  const draft = projectFuture(
    applyScenario(input, { purchases: [{ card: "cartao", cents: 180000n, installments: 6, day: "2026-12-15", label: "Compra simulada" }] }),
  );
  const ghost = ghostTotals(result, draft, 24);
  assert.equal(ghost.length, 24);
  const changed = ghost.flatMap((g, i) => (g === null ? [] : [i]));
  assert.ok(changed.length >= 6, "a compra muda pelo menos seis faturas");
  changed.forEach((i) => assert.equal(ghost[i], Math.round(Number(result.rows[i].card) / 100)));
  assert.ok(ghost.some((g) => g === null), "colunas iguais ficam null");
});

test("dia a dia: mensal ↔ semanal em centavos (× 7 / 30) e volta ao mesmo real", () => {
  assert.equal(weeklyFromMonthly(150000n), 35000n);
  assert.equal(monthlyFromWeekly(35000n), 150000n);
  assert.equal(weeklyFromMonthly(100000n), 23333n);
  assert.equal(weeklyFromMonthly(0n), 0n);
  for (let reais = 0; reais <= 20000; reais += 50) {
    const back = monthlyFromWeekly(weeklyFromMonthly(BigInt(reais) * 100n));
    assert.equal(Math.round(Number(back) / 100), reais, `R$ ${reais}`);
  }
});

test("everydayPatch: igual ao plano salvo não muda nada; senão, o semanal novo", () => {
  assert.equal(everydayPatch(35000n, 1500), undefined);
  assert.equal(everydayPatch(35000n, 1450), weeklyFromMonthly(145000n));
  assert.equal(everydayPatch(null, 1500), 35000n);
});

test("installmentLabel e purchaseDayOptions", () => {
  assert.equal(installmentLabel(1800, 6), "6× de R$ 300");
  assert.equal(installmentLabel(1000, 3), "3× de R$ 334");
  assert.equal(installmentLabel(1800, 6, true), "6× de ••••");
  const days = purchaseDayOptions(input);
  assert.equal(days.length, 12);
  assert.deepEqual(days[0], { value: "2026-12-01", label: "Hoje" });
  assert.deepEqual(days[1], { value: "2027-01-01", label: "jan/27" });
  assert.deepEqual(days[11], { value: "2027-11-01", label: "nov/27" });
});

test("minFree: folga mínima no horizonte, e a compra simulada a reduz", () => {
  assert.equal(minFree(result, 12), -15000n);
  assert.equal(minFree(result, 1), result.rows[0].free);
  assert.equal(minFree(projectFuture(emptyInput()), 0), 0n);
  const draft = projectFuture(
    applyScenario(input, { purchases: [{ card: "cartao", cents: 180000n, installments: 6, day: "2026-12-15", label: "Compra simulada" }] }),
  );
  assert.ok(minFree(draft, 12) < minFree(result, 12));
});

test("contributionChange: igual ao plano limpa; zero vira pausa; outro valor é aporte", () => {
  assert.deepEqual(contributionChange(50000n, 500), { kind: "clear" });
  assert.deepEqual(contributionChange(0n, 0), { kind: "clear" });
  assert.deepEqual(contributionChange(50000n, 0), { kind: "pause" });
  assert.deepEqual(contributionChange(50000n, 700), { kind: "contribute", cents: 70000n });
  assert.deepEqual(contributionChange(0n, 150), { kind: "contribute", cents: 15000n });
});

test("plannedMonthly e reachText: plano vigente do mês 0 e quando o objetivo completa", () => {
  const [reserva, viagem] = input.goals;
  assert.equal(plannedMonthly(reserva.plans, input.startMonth), 50000n);
  assert.equal(plannedMonthly(viagem.plans, input.startMonth), 0n);
  assert.equal(reachText(result, "reserva"), "Completa em mar/28.");
  assert.equal(reachText(result, "viagem"), "Não completa no horizonte.");
  assert.equal(reachText(result, "nao-existe"), "Não completa no horizonte.");
});

test("neededForDeadline: aporte necessário até o prazo; nada sem prazo", () => {
  const [reserva, viagem] = input.goals;
  assert.equal(neededForDeadline(input.startMonth, reserva), null);
  // Viagem: faltam R$ 3.100; o mês corrente não conta, então 12 aportes até dez/27 = R$ 259 (para cima).
  assert.equal(neededForDeadline(input.startMonth, viagem), 25900n);
  assert.equal(neededForDeadline("2028-01", viagem), null, "prazo já passou");
});

test("draftSummary: singular, plural e primeira linha do que mudou", () => {
  assert.equal(draftSummary(1, ["Viagem: aporte de R$ 700/mês"]), "1 mudança: Viagem: aporte de R$ 700/mês");
  assert.equal(draftSummary(2, ["a", "b"]), "2 mudanças: a");
  assert.equal(draftSummary(3, []), "3 mudanças");
});

test("aplicar e retirar a compra simulada pela chave (label) deixa o cenário como estava", async () => {
  const { futureReducer, initialState, isDirty, changeCount } = await import("../app/future/future-state.ts");
  const { SIMULATED_PURCHASE } = await import("../app/future/view-model.ts");
  let s = futureReducer(initialState(24), { type: "loaded", input });
  const buy = (cents: bigint) => ({
    type: "patch" as const,
    patch: { purchases: [{ card: "cartao", cents, installments: 6, day: "2026-12-01", label: SIMULATED_PURCHASE }] },
  });
  s = futureReducer(s, buy(180000n));
  s = futureReducer(s, buy(240000n));
  assert.equal(changeCount(s.scenario), 1, "reaplicar substitui, não acumula");
  assert.equal(s.scenario.purchases?.[0].cents, 240000n);
  s = futureReducer(s, { type: "remove", list: "purchases", key: SIMULATED_PURCHASE });
  assert.equal(isDirty(s.scenario), false);
});

test("cardBars: camadas por categoria, as menores em \"Demais categorias\" e a compra simulada à parte", () => {
  const cats = ["Casa", "Casa", "Lazer", "Pet", "Saúde", "Transporte", "Educação", "Moda"];
  const many = {
    ...input,
    cards: input.cards.map((c, ci) =>
      ci > 0
        ? c
        : {
            ...c,
            installments: [
              ...c.installments,
              ...cats.map((category, j) => ({
                key: `extra-${j}`, label: `Compra ${j}`, cents: BigInt(100 * (20 - j)), k: 1, n: 3,
                month: input.startMonth, lastMonth: input.startMonth, category,
              })),
            ],
          },
    ),
  };
  const sim = applyScenario(many, {
    purchases: [{ card: many.cards[0].card, cents: 60000n, installments: 3, day: `${input.startMonth}-01`, label: "Sofá" }],
  });
  const r = projectFuture(sim);
  const bars = cardBars(sim, r, 6);
  const cat = bars.layers.filter((l) => l.key.startsWith("cat:")).map((l) => l.label);
  const legendCat = bars.legend.filter((l) => l.key.startsWith("cat:")).map((l) => l.label);
  // 8 categorias (as 7 + as parcelas do exemplo, sem categoria): as 5 maiores
  // ganham camada própria com nome; as 3 menores também viram camada própria
  // (pra quebrar visualmente), mas na legenda somem numa linha só "Demais".
  assert.equal(cat.length, 8);
  assert.equal(legendCat.length, 6);
  assert.ok(cat.includes("Casa") && cat.includes("Moda"), "Moda vira camada própria dentro de 'Demais', não some");
  assert.ok(!legendCat.includes("Moda"), "mas não aparece sozinha na legenda");
  assert.equal(legendCat.at(-1), "Demais categorias");
  assert.equal(cat.at(-1), "Moda", "a menor de todas fica no topo da pilha de 'Demais'");
  assert.equal(bars.layers.at(-1)!.label, "Sofá", "a compra simulada fica no topo, com o nome dela");
  for (const [i, row] of r.rows.slice(0, 6).entries())
    assert.equal(bars.values[i].reduce((a, b) => a + b, 0), Math.round(Number(row.card) / 100));
});

test("headline: sem aporte planejado em nenhum objetivo, diz isso e mostra a folga do mês mais apertado", () => {
  const bare = {
    ...input,
    income: input.income.map((m) => ({ ...m, cents: m.cents + 100000n, items: m.items.map((i) => ({ ...i, cents: i.cents + 100000n })) })),
    goals: input.goals.map((g) => ({ ...g, plans: [] })),
  };
  const r = projectFuture(bare);
  assert.ok(r.rows.every((row) => row.free >= 0n));
  const h = headline(bare, r, 24);
  assert.equal(h.lead, "Nenhum objetivo tem aporte planejado.");
  assert.match(h.detail, /^O mês mais apertado \(.+\) ainda deixa R\$ [\d.]+ de folga\./);
});

test("cashTimeline: frase do ponto mais baixo, movimentos com data e saldo, e valores ocultos", () => {
  const dated = {
    ...input,
    income: input.income.map((m) => ({ ...m, items: m.items.map((l) => ({ ...l, date: `${m.month}-25` })) })),
  };
  const r = projectFuture(dated);
  const t = cashTimeline(r.rows[2]);
  assert.match(t.summary, /antes de o salário entrar\.$/);
  const salary = t.rows.find((x) => x.tone === "in")!;
  assert.equal(salary.date.slice(0, 2), "25");
  assert.match(salary.amount, /^\+R\$/);
  const hidden = cashTimeline(r.rows[2], true);
  assert.ok(hidden.rows.every((x) => !/\d{3}/.test(x.amount + x.balance)));
});

test("cashTimeline: o dia a dia entre os movimentos explica cada queda do saldo", () => {
  const dated = {
    ...input,
    everyday: { weekly: 70000n, source: "declarado" as const, cardShareBp: 4000 },
    income: input.income.map((m) => ({ ...m, items: m.items.map((l) => ({ ...l, date: `${m.month}-25` })) })),
  };
  const r = projectFuture(dated);
  const row = r.rows[2];
  const t = cashTimeline(row);
  const num = (v: string) => Number(v.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", "."));
  assert.ok(t.rows.some((x) => x.tone === "everyday" && /^Dia a dia, \d\d\/\d\d a \d\d\/\d\d$/.test(x.label)));
  // Cada linha: saldo anterior + valor = saldo dela (em reais, com arredondamento).
  let prev = Math.round(Number(row.cash.opening) / 100);
  for (const x of t.rows) {
    assert.ok(Math.abs(prev + num(x.amount) - num(x.balance)) <= 1, `${x.label}: ${prev} ${x.amount} → ${x.balance}`);
    prev = num(x.balance);
  }
  assert.equal(prev, Math.round(Number(row.cash.closing) / 100), "a última linha fecha o mês");
});

test("headline: saldo negativo antes do salário avisa o dia, mesmo com o mês fechando no azul", () => {
  const dated = {
    ...input,
    startBalance: 0n,
    income: input.income.map((m) => ({ ...m, cents: m.cents + 100000n, items: m.items.map((l) => ({ ...l, cents: l.cents + 100000n, date: `${m.month}-28` })) })),
  };
  const r = projectFuture(dated);
  assert.ok(r.rows.every((row) => row.free >= 0n));
  const h = headline(dated, r, 24);
  assert.match(h.lead, /^Em \d\d\/\d\d o saldo fica em −R\$/);
});

test("monthCalc: contas fixas mostra o mês inteiro, abre em já pagas e pendentes, e a folga não muda", () => {
  const paidIn = { ...input, paidFixed: [{ month: result.rows[1].month, cents: 50000n, items: [{ key: "p", label: "Aluguel", cents: 50000n, source: "recorrencia" as const, date: `${result.rows[1].month}-01` }] }] };
  const before = monthCalc(input, result, 1);
  const after = monthCalc(paidIn, result, 1);
  assert.equal(after.total.value, before.total.value);
  const fixed = (c: typeof after) => c.lines.find((l) => l.key === "fixed")!;
  assert.equal(fixed(after).value, fixed(before).value - 500);
  const sub = after.lines.filter((l) => l.nested).map((l) => [l.label, l.value]);
  assert.deepEqual(sub, [["Já pagas", 500], ["Pendentes", -fixed(before).value]]);
  const t = cashTimeline(result.rows[1], false, paidIn.paidFixed[0].items);
  assert.deepEqual([t.rows[0].label, t.rows[0].balance, t.rows[0].tone], ["Aluguel", "paga", "paid"]);
});
