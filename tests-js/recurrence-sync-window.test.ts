import { test } from "node:test";
import assert from "node:assert/strict";
import { syncWindow } from "../app/fixed/sync-window.ts";

test("mês atual: do mês anterior até o fim de hoje + 2 meses", () => {
  assert.deepEqual(syncWindow("2026-11", "2026-11"), {
    from: "2026-10-01",
    through: "2027-01-31",
  });
});

test("mês passado puxa o início para trás", () => {
  assert.deepEqual(syncWindow("2026-11", "2026-03"), {
    from: "2026-02-01",
    through: "2027-01-31",
  });
});

test("mês futuro além do horizonte estica o fim", () => {
  assert.deepEqual(syncWindow("2026-11", "2027-06"), {
    from: "2026-10-01",
    through: "2027-06-30",
  });
});

test("vira o ano e respeita fevereiro", () => {
  assert.deepEqual(syncWindow("2026-12", "2026-12"), {
    from: "2026-11-01",
    through: "2027-02-28",
  });
  assert.equal(syncWindow("2027-01", "2028-02").through, "2028-02-29");
});
