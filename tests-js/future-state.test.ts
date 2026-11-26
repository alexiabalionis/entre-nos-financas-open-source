import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changeCount,
  futureReducer,
  initialState,
  isDirty,
  planWrites,
  type FutureState,
} from "../app/future/future-state.ts";
import { briefingInput } from "../app/future/fixtures.ts";
import { toApiAmount } from "../app/lib/cents.ts";

const loaded = (): FutureState => futureReducer(initialState(12), { type: "loaded", input: briefingInput() });

test("carregar guarda o plano salvo e começa sem rascunho", () => {
  const s = loaded();
  assert.equal(s.input?.goals.length, 2);
  assert.deepEqual(s.scenario, {});
  assert.equal(isDirty(s.scenario), false);
});

test("patch substitui o item de mesma chave e acrescenta os novos", () => {
  let s = loaded();
  s = futureReducer(s, { type: "patch", patch: { contributions: [{ goalId: "viagem", fromMonth: "2026-12", months: null, cents: 10000n }] } });
  s = futureReducer(s, { type: "patch", patch: { contributions: [{ goalId: "viagem", fromMonth: "2027-01", months: 3, cents: 20000n }, { goalId: "reserva", fromMonth: "2027-01", months: 1, cents: 1000n }] } });
  assert.deepEqual(s.scenario.contributions?.map((c) => [c.goalId, c.cents]), [["viagem", 20000n], ["reserva", 1000n]]);
  s = futureReducer(s, { type: "patch", patch: { shocks: [{ kind: "despesa", month: "2027-03", months: 1, cents: 5n, label: "A" }] } });
  s = futureReducer(s, { type: "patch", patch: { shocks: [{ kind: "despesa", month: "2027-04", months: 1, cents: 9n, label: "A" }] } });
  assert.deepEqual(s.scenario.shocks?.map((k) => [k.label, k.cents]), [["A", 9n]]);
});

test("aporte de valor zero remove a entrada do objetivo", () => {
  let s = loaded();
  s = futureReducer(s, { type: "patch", patch: { contributions: [{ goalId: "viagem", fromMonth: "2026-12", months: null, cents: 10000n }] } });
  s = futureReducer(s, { type: "patch", patch: { contributions: [{ goalId: "viagem", fromMonth: "2026-12", months: null, cents: 0n }] } });
  assert.equal(s.scenario.contributions, undefined);
  assert.equal(isDirty(s.scenario), false);
});

test("campo escalar substitui e undefined remove", () => {
  let s = loaded();
  s = futureReducer(s, { type: "patch", patch: { everydayWeekly: 20000n, freedTo: "objetivos" } });
  assert.deepEqual([s.scenario.everydayWeekly, s.scenario.freedTo], [20000n, "objetivos"]);
  s = futureReducer(s, { type: "patch", patch: { everydayWeekly: undefined } });
  assert.deepEqual(s.scenario, { freedTo: "objetivos" });
});

test("remove tira o item da lista pela chave; replace e discard", () => {
  let s = loaded();
  s = futureReducer(s, { type: "patch", patch: { pauses: [{ goalId: "reserva", fromMonth: "2027-02", months: 3 }], purchases: [{ card: "cartao", cents: 100000n, installments: 4, day: "2026-12-05", label: "TV" }] } });
  s = futureReducer(s, { type: "remove", list: "purchases", key: "TV" });
  assert.deepEqual(Object.keys(s.scenario), ["pauses"]);
  s = futureReducer(s, { type: "replace", scenario: { freedTo: "folga" } });
  assert.deepEqual(s.scenario, { freedTo: "folga" });
  s = futureReducer(s, { type: "discard" });
  assert.deepEqual(s.scenario, {});
});

test("changeCount soma itens das listas e um por campo escalar", () => {
  assert.equal(changeCount({}), 0);
  assert.equal(
    changeCount({
      contributions: [{ goalId: "a", fromMonth: "2026-12", months: null, cents: 1n }],
      pauses: [{ goalId: "b", fromMonth: "2026-12", months: 2 }],
      everydayWeekly: 1n,
      freedTo: "objetivos",
    }),
    4,
  );
});

test("select e setMonths ficam dentro do horizonte", () => {
  let s = loaded();
  s = futureReducer(s, { type: "select", index: 99 });
  assert.equal(s.selected, 11);
  s = futureReducer(s, { type: "select", index: -4 });
  assert.equal(s.selected, 0);
  s = futureReducer(futureReducer(s, { type: "select", index: 10 }), { type: "setMonths", months: 6 });
  assert.deepEqual([s.months, s.selected], [6, 5]);
});

test("recarregar mantém a simulação e tira o que aponta para objetivo que sumiu", () => {
  let s = loaded();
  s = futureReducer(s, {
    type: "patch",
    patch: {
      contributions: [
        { goalId: "viagem", fromMonth: "2026-12", months: null, cents: 10000n },
        { goalId: "sumiu", fromMonth: "2026-12", months: null, cents: 10000n },
      ],
      everydayWeekly: 5000n,
    },
  });
  s = futureReducer(s, { type: "loaded", input: briefingInput() });
  assert.deepEqual(s.scenario.contributions?.map((c) => c.goalId), ["viagem"]);
  assert.equal(s.scenario.everydayWeekly, 5000n);
});

test("planWrites: aporte até o fim vira um intervalo; com fim, o valor de antes volta no mês seguinte", () => {
  const input = briefingInput();
  // até o fim do horizonte (24 meses a partir de dez/26)
  assert.deepEqual(
    planWrites(input, { contributions: [{ goalId: "viagem", fromMonth: "2026-12", months: null, cents: 23900n }] }),
    [{ goal_id: "viagem", from_month: "2026-12", months: 24, cents: 23900n }],
  );
  // um mês só: a reserva volta ao plano de R$ 500 em mar/27 (não há plano explícito lá)
  assert.deepEqual(
    planWrites(input, { contributions: [{ goalId: "reserva", fromMonth: "2027-02", months: 1, cents: 10000n }] }),
    [
      { goal_id: "reserva", from_month: "2027-02", months: 1, cents: 10000n },
      { goal_id: "reserva", from_month: "2027-03", months: 1, cents: 50000n },
    ],
  );
  // pausa é aporte zero e também devolve o valor de antes
  assert.deepEqual(
    planWrites(input, { pauses: [{ goalId: "reserva", fromMonth: "2027-02", months: 3 }] }),
    [
      { goal_id: "reserva", from_month: "2027-02", months: 3, cents: 0n },
      { goal_id: "reserva", from_month: "2027-05", months: 1, cents: 50000n },
    ],
  );
});

test("planWrites: plano explícito no mês do fim não é sobrescrito; objetivo novo e simulações não gravam", () => {
  const input = briefingInput();
  input.goals[0].plans.push({ month: "2027-03", planned: 70000n });
  assert.deepEqual(
    planWrites(input, { contributions: [{ goalId: "reserva", fromMonth: "2027-02", months: 1, cents: 10000n }] }),
    [{ goal_id: "reserva", from_month: "2027-02", months: 1, cents: 10000n }],
  );
  assert.deepEqual(
    planWrites(input, {
      newGoals: [{ id: "n", name: "Carro", target: 1n, saved: 0n, deadlineMonth: null, monthly: 1n }],
      purchases: [{ card: "cartao", cents: 1n, installments: 1, day: "2026-12-05" }],
      shocks: [{ kind: "despesa", month: "2027-01", months: 1, cents: 1n, label: "x" }],
      everydayWeekly: 1n,
    }),
    [],
  );
  // objetivo que não existe mais não gera chamada
  assert.deepEqual(planWrites(input, { contributions: [{ goalId: "outro", fromMonth: "2027-02", months: 1, cents: 1n }] }), []);
});

test("toApiAmount: centavos viram texto no formato da API", () => {
  assert.equal(toApiAmount(0n), "0,00");
  assert.equal(toApiAmount(5n), "0,05");
  assert.equal(toApiAmount(15000n), "150,00");
  assert.equal(toApiAmount(123456n), "1234,56");
  assert.throws(() => toApiAmount(-1n), RangeError);
});
