import { test } from "node:test";
import assert from "node:assert/strict";
import { columnAt, flagAt, laneFill } from "../app/ds/lane-tracks-model.ts";

test("laneFill", () => {
  assert.equal(laneFill(null, 12), 1);
  assert.equal(laneFill(0, 12), 1 / 12);
  assert.equal(laneFill(5, 12), 0.5);
  assert.equal(laneFill(11, 12), 1);
  assert.equal(laneFill(20, 12), 1);
});

test("flagAt", () => {
  assert.equal(flagAt(null, 12), null);
  assert.equal(flagAt(0, 12), 0.5 / 12);
  assert.equal(flagAt(5, 12), 5.5 / 12);
  assert.equal(flagAt(12, 12), null);
  assert.equal(flagAt(20, 12), null);
});

test("columnAt", () => {
  assert.equal(columnAt(0, 12), 0);
  assert.equal(columnAt(0.999, 12), 11);
  assert.equal(columnAt(1, 12), 11);
  assert.equal(columnAt(0.5, 12), 6);
  assert.equal(columnAt(-0.2, 12), 0);
});
