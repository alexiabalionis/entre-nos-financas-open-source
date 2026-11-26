import { test } from "node:test";
import assert from "node:assert/strict";
import { percentShares } from "../app/ds/chart-data.ts";

test("percentShares soma sempre 100 pelo maior resto", () => {
  // Composição real de 09/11/2026: Cartões, Moradia, Educação, Família, Lazer.
  const out = percentShares([5782, 3261, 850, 444, 400]);
  assert.equal(out.reduce((s, v) => s + v, 0), 100);
  assert.deepEqual(out, [54, 30, 8, 4, 4]);
  assert.deepEqual(percentShares([1, 1, 1]), [34, 33, 33]);
});

test("percentShares trata vazio, zero e negativo", () => {
  assert.deepEqual(percentShares([]), []);
  assert.deepEqual(percentShares([0, 0]), [0, 0]);
  assert.deepEqual(percentShares([-5, 10]), [0, 100]);
});
