import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveProviderStatus } from "../src/server/bank-settled.ts";

test("PENDING com data passada conta como confirmado; de hoje em diante segue PENDING", () => {
  const today = "2026-11-15";
  assert.equal(effectiveProviderStatus("PENDING", "2026-10-03", today), "POSTED");
  assert.equal(effectiveProviderStatus("PENDING", "2026-11-14", today), "POSTED");
  assert.equal(effectiveProviderStatus("PENDING", "2026-11-15", today), "PENDING");
  assert.equal(effectiveProviderStatus("PENDING", "2026-12-01", today), "PENDING");
  assert.equal(effectiveProviderStatus("POSTED", "2026-12-01", today), "POSTED");
});
