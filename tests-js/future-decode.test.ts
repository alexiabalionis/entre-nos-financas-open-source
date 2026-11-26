import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScenario, projectFuture } from "../src/domain/future-months.ts";
import { briefingInput, emptyInput } from "../app/future/fixtures.ts";
import { decodeFutureInput, decodeFutureResult, encodeFutureInput } from "../app/future/decode.ts";

const wire = (v: unknown) => JSON.parse(JSON.stringify(encodeFutureInput(v as never)));

test("o input volta igual depois de ir e voltar pelo fio", () => {
  const input = briefingInput();
  assert.deepEqual(decodeFutureInput(wire(input)), input);
  assert.deepEqual(decodeFutureInput(wire(emptyInput())), emptyInput());
});

test("o resultado decodificado é o mesmo que o motor calcula localmente", () => {
  const input = briefingInput();
  const withScenario = applyScenario(input, {
    contributions: [{ goalId: "viagem", fromMonth: "2026-12", months: null, cents: 23900n }],
  });
  for (const i of [input, withScenario]) {
    const result = projectFuture(i);
    // O resultado do servidor passa por JSON: bigint viraria erro, então vai como texto.
    const text = JSON.parse(
      JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    assert.deepEqual(decodeFutureResult(text), result);
  }
});

test("campo bigint que não é texto de dígitos lança erro com o caminho", () => {
  const bad = wire(briefingInput());
  bad.startBalance = "12a";
  assert.throws(() => decodeFutureInput(bad), /input\.startBalance/);
  const num = wire(briefingInput());
  num.income[0].cents = 600000;
  assert.throws(() => decodeFutureInput(num), /input\.income\[0\]\.cents/);
});

test("null passa só onde o campo aceita (dia a dia semanal)", () => {
  const ok = wire(briefingInput());
  assert.equal(decodeFutureInput(ok).everyday.weekly, null);
  const bad = wire(briefingInput());
  bad.startBalance = null;
  assert.throws(() => decodeFutureInput(bad), /input\.startBalance/);
});

test("rótulo numérico continua texto: só os campos de dinheiro viram bigint", () => {
  const input = briefingInput();
  input.goals[0].name = "2027";
  input.fixed[0].items[0].label = "12345";
  const back = decodeFutureInput(wire(input));
  assert.equal(back.goals[0].name, "2027");
  assert.equal(back.fixed[0].items[0].label, "12345");
});

test("formato inesperado lança erro claro", () => {
  assert.throws(() => decodeFutureInput(null), /Esperava um objeto/);
  const bad = wire(briefingInput());
  bad.cards = "nada";
  assert.throws(() => decodeFutureInput(bad), /Esperava uma lista em input\.cards/);
});
