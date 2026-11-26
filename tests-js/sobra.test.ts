import { test } from "node:test";
import assert from "node:assert/strict";
import { floor50, ladder, roomFor, shortMonths } from "../src/domain/sobra.ts";

// Sobra média R$ 970; meses fechados com sobra de 1.500, 1.200, 600, 200 e −300.
const h = {
  avg: 97000n,
  kept: [
    { month: "2026-06", cents: 150000n },
    { month: "2026-07", cents: 120000n },
    { month: "2026-08", cents: 60000n },
    { month: "2026-09", cents: 20000n },
    { month: "2026-10", cents: -30000n },
  ],
};

test("floor50 e roomFor", () => {
  assert.equal(floor50(97099n), 95000n);
  assert.equal(floor50(-1n), 0n);
  assert.equal(roomFor(h, 30000n), 67000n, "aportes do plano saem do espaço");
});

test("shortMonths: meses em que sobrou menos que o compromisso", () => {
  assert.deepEqual(shortMonths(h, 0n, 83400n), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(shortMonths(h, 0n, 10000n), ["2026-10"]);
});

test("ladder: valores menores com menos meses curtos, nunca acima da média", () => {
  // R$ 834 falta em 3 meses; R$ 600 em 2; R$ 200 em 1. Um mês negativo nunca some.
  assert.deepEqual(ladder(h, 0n, 83400n), [
    { cents: 60000n, short: 2 },
    { cents: 20000n, short: 1 },
  ]);
  // Acima da média (não cabe): começa no espaço médio, mesmo sem reduzir meses curtos.
  assert.deepEqual(ladder(h, 0n, 500000n)[0], { cents: 95000n, short: 3 });
});
