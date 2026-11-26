import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents, formatReais, formatSignedReais, fromReais, toReais } from "../app/lib/cents.ts";

test("toReais arredonda meio para cima, simétrico", () => {
  assert.equal(toReais(15050n), 151);
  assert.equal(toReais(15049n), 150);
  assert.equal(toReais(-15050n), -151);
  assert.equal(toReais(0n), 0);
});

test("fromReais aceita inteiros e rejeita o resto", () => {
  assert.equal(fromReais(4100), 410000n);
  assert.equal(fromReais(-3), -300n);
  assert.throws(() => fromReais(1.5));
  assert.throws(() => fromReais(Number.NaN));
  assert.throws(() => fromReais(Infinity));
});

test("formatReais", () => {
  assert.equal(formatReais(4100), "R$ 4.100");
  assert.equal(formatReais(-150), "−R$ 150");
  assert.equal(formatReais(4100, true), "••••");
  assert.equal(formatReais(0), "R$ 0");
});

test("formatCents e formatSignedReais", () => {
  assert.equal(formatCents(410000n), "R$ 4.100");
  assert.equal(formatCents(410000n, true), "••••");
  assert.equal(formatSignedReais(50), "+R$ 50");
  assert.equal(formatSignedReais(-50), "−R$ 50");
  assert.equal(formatSignedReais(0), "R$ 0");
  assert.equal(formatSignedReais(50, true), "••••");
});

test("maskMoney esconde valores dentro de frases só com hidden", async () => {
  const { maskMoney } = await import("../app/lib/cents.ts");
  const s = "R$ 2.300 guardados ÷ R$ 2.400 de essenciais; folga −R$ 150 e +R$ 1.234,56.";
  assert.equal(maskMoney(s, false), s);
  assert.equal(maskMoney(s, true), "•••• guardados ÷ •••• de essenciais; folga •••• e ••••.");
  assert.equal(maskMoney("Faltam 13 meses", true), "Faltam 13 meses");
});
