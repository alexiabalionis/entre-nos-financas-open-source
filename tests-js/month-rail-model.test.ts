import { test } from "node:test";
import assert from "node:assert/strict";
import { railKey } from "../app/ds/month-rail-model.ts";

test("railKey: setas, Home e End", () => {
  assert.equal(railKey("ArrowRight", 2, 6), 3);
  assert.equal(railKey("ArrowLeft", 2, 6), 1);
  assert.equal(railKey("Home", 4, 6), 0);
  assert.equal(railKey("End", 1, 6), 5);
});

test("railKey: PageDown e PageUp andam de 3 em 3", () => {
  assert.equal(railKey("PageDown", 1, 12), 4);
  assert.equal(railKey("PageUp", 5, 12), 2);
});

test("railKey: limita nas pontas", () => {
  assert.equal(railKey("ArrowLeft", 0, 6), 0);
  assert.equal(railKey("ArrowRight", 5, 6), 5);
  assert.equal(railKey("PageDown", 4, 6), 5);
  assert.equal(railKey("PageUp", 1, 6), 0);
});

test("railKey: outras teclas devolvem null", () => {
  assert.equal(railKey("a", 2, 6), null);
  assert.equal(railKey("Enter", 2, 6), null);
});
