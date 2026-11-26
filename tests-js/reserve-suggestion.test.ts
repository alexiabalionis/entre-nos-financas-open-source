import { test } from "node:test";
import assert from "node:assert/strict";
import {
  immediateCapacity,
  suggestAmount,
  firstTarget,
  livreWith,
  moneyStatus,
} from "../src/domain/reserve-suggestion.ts";

const base = {
  state: "CONFIRMADO" as const,
  shown: 34000n,
  incomeDetected: true,
  receiptDueUndetected: false,
};

test("immediateCapacity", () => {
  const cases = [
    { name: "salário entrou", input: base, want: 34000n },
    { name: "com ressalva", input: { ...base, state: "COM_RESSALVA" as const }, want: 34000n },
    { name: "depende de dados", input: { ...base, state: "DEPENDE_DE_DADOS" as const }, want: null },
    { name: "sem folga", input: { ...base, state: "SEM_FOLGA" as const }, want: null },
    { name: "indeterminado", input: { ...base, state: "INDETERMINADO" as const }, want: null },
    { name: "shown nulo", input: { ...base, shown: null }, want: null },
    { name: "renda não detectada", input: { ...base, incomeDetected: false }, want: null },
    { name: "recebimento previsto não detectado", input: { ...base, receiptDueUndetected: true }, want: null },
  ];
  for (const c of cases) assert.equal(immediateCapacity(c.input), c.want, c.name);
});

test("suggestAmount", () => {
  const cases = [
    { name: "metade", capacity: 34000n, saved: 0n, target: 45000n, want: 17000n },
    { name: "6000", capacity: 6000n, saved: 0n, target: 45000n, want: 3000n },
    { name: "abaixo de R$ 20", capacity: 1500n, saved: 0n, target: 45000n, want: 0n },
    { name: "capacidade nula", capacity: null, saved: 0n, target: 45000n, want: 0n },
    { name: "limitado pelo alvo", capacity: 34000n, saved: 40000n, target: 45000n, want: 5000n },
    { name: "alvo atingido", capacity: 34000n, saved: 45000n, target: 45000n, want: 0n },
    { name: "alvo ultrapassado", capacity: 34000n, saved: 50000n, target: 45000n, want: 0n },
    { name: "arredonda para baixo", capacity: 2500n, saved: 0n, target: 45000n, want: 1000n },
    { name: "resto menor que R$ 10", capacity: 34000n, saved: 44500n, target: 45000n, want: 0n },
  ];
  // Sem histórico do dia a dia (usualSpend null): metade do livre.
  for (const c of cases) {
    assert.equal(
      suggestAmount({ capacity: c.capacity, saved: c.saved, target: c.target, usualSpend: null }),
      c.want,
      c.name,
    );
  }
});

test("suggestAmount pelo hábito: o que sobra depois do dia a dia de sempre", () => {
  const base = { saved: 0n, target: 1_000_000n };
  // 4.886 livres, dia a dia de sempre 3.600 até o salário: sobra 1.286 -> 1.280.
  assert.equal(suggestAmount({ ...base, capacity: 488658n, usualSpend: 360000n }), 128000n);
  // Limitado ao que falta para a meta.
  assert.equal(
    suggestAmount({ capacity: 488658n, usualSpend: 360000n, saved: 0n, target: 50000n }),
    50000n,
  );
  // O hábito come tudo: não sugere guardar.
  assert.equal(suggestAmount({ ...base, capacity: 300000n, usualSpend: 360000n }), 0n);
  assert.equal(suggestAmount({ ...base, capacity: 360500n, usualSpend: 360000n }), 0n);
});

test("firstTarget", () => {
  assert.equal(firstTarget({ weeklyTypical: null }), 50000n);
  assert.equal(firstTarget({ weeklyTypical: 20500n }), 45000n);
  assert.equal(firstTarget({ weeklyTypical: 3000n }), 10000n);
  assert.equal(firstTarget({ weeklyTypical: 25000n }), 50000n);
});

test("livreWith", () => {
  const cases = [
    { shown: 19000n, remaining: 15000n, separated: 0n, planned: 10000n, want: 24000n },
    { shown: 19000n, remaining: 0n, separated: 10000n, planned: 10000n, want: 19000n },
    { shown: 19000n, remaining: 0n, separated: 12000n, planned: 10000n, want: 19000n },
  ];
  for (const c of cases) {
    const { want, ...input } = c;
    assert.equal(livreWith(input), want);
  }
});

test("moneyStatus", () => {
  const margin = 20000n;
  assert.deepEqual(moneyStatus({ livre: 1000n, margin }), { kind: "free", livre: 1000n });
  assert.deepEqual(moneyStatus({ livre: 999n, margin }), { kind: "zero" });
  assert.deepEqual(moneyStatus({ livre: 0n, margin }), { kind: "zero" });
  assert.deepEqual(moneyStatus({ livre: -16000n, margin }), { kind: "margin", used: 16000n });
  assert.deepEqual(moneyStatus({ livre: -20000n, margin }), { kind: "margin", used: 20000n });
  assert.deepEqual(moneyStatus({ livre: -21000n, margin }), { kind: "short", missing: 1000n });
  assert.deepEqual(moneyStatus({ livre: -1n, margin: 0n }), { kind: "short", missing: 1n });
});
