import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFuture } from "../src/domain/future-months.ts";
import { briefingInput, emptyInput } from "../app/future/fixtures.ts";
import { cardLayerColor, goalColor } from "../app/future/colors.ts";

test("cenário do briefing: a reserva completa em mar/2028 e só jan/27 fica sem folga", () => {
  const r = projectFuture(briefingInput());
  assert.equal(r.reach.reserva, "2028-03");
  assert.deepEqual(r.conflicts.map((c) => c.month), ["2027-01"]);
});

test("entrada vazia roda sem erro e sem nada para mostrar", () => {
  const r = projectFuture(emptyInput());
  assert.equal(r.rows.length, 24);
  assert.deepEqual(r.milestones, []);
  assert.equal(r.viability.level, "ok");
});

test("cores de dado: objetivos repetem a paleta; camadas da fatura têm cor fixa", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(goalColor), [
    "var(--family-cat-4)",
    "var(--family-cat-6)",
    "var(--family-cat-2)",
    "var(--family-cat-8)",
    "var(--family-cat-4)",
  ]);
  assert.equal(goalColor(-1), "var(--family-cat-8)");
  assert.equal(cardLayerColor("recorrente"), "var(--family-cat-cards)");
  assert.equal(cardLayerColor("estimado"), "var(--family-cat-none)");
  assert.equal(cardLayerColor("fatura"), "var(--family-cat-9)");
  assert.equal(cardLayerColor("pontual"), "var(--family-cat-11)");
  assert.equal(cardLayerColor("parcela", 0), "var(--family-cat-1)");
  assert.equal(cardLayerColor("parcela", 5), "var(--family-cat-3)");
});
