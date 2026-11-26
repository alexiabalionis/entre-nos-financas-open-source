import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseEffect, pausedFrom, pausedPlanned } from "../app/copilot/pause.ts";
import { moneyOf } from "../app/copilot/money.ts";
import type { CopilotWire } from "../src/server/copilot.ts";

const money = moneyOf(false);
type Plan = NonNullable<NonNullable<CopilotWire["goal"]>["plan"]>;
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "p",
  planned: "15000",
  separated: "0",
  remaining: "15000",
  plan_date: "2026-11-05",
  previous: null,
  ...over,
});

function wire(p: Plan | null, livre: string, margin = "20000"): CopilotWire {
  return {
    livre,
    margin,
    goal: p && {
      id: "g",
      name: "Primeira reserva",
      saved: p.separated,
      verified: "0",
      declared: "0",
      location: "elsewhere",
      version: 2,
      plan: p,
      cycle: "planned",
    },
  } as CopilotWire;
}

test("pausar mostra o antes e o depois na régua do topo", () => {
  // Livre -160 com margem 200: usando 160. Pausando 150: usando 10.
  assert.deepEqual(pauseEffect(wire(plan(), "-16000"), money), {
    now: "usando R$ 160,00 da margem",
    paused: "usando R$ 10,00 da margem",
  });
  // Faltava mais que a margem; pausando volta a caber na margem.
  assert.deepEqual(pauseEffect(wire(plan(), "-25000"), money), {
    now: "faltam R$ 50,00",
    paused: "usando R$ 100,00 da margem",
  });
  assert.deepEqual(pauseEffect(wire(plan(), "-5000"), money), {
    now: "usando R$ 50,00 da margem",
    paused: "R$ 100,00 livres",
  });
  assert.equal(pauseEffect(wire(plan({ remaining: "0" }), "-16000"), money), null);
  assert.equal(pauseEffect(wire(null, "-16000"), money), null);
});

test("pausar vale o que já foi separado", () => {
  assert.equal(pausedPlanned(plan()), 0n);
  assert.equal(pausedPlanned(plan({ separated: "5000", remaining: "10000" })), 5000n);
});

test("pausada só quando o plano caiu para zero depois de ter valor", () => {
  assert.equal(pausedFrom(plan({ planned: "0", remaining: "0", previous: "15000" })), 15000n);
  assert.equal(pausedFrom(plan({ planned: "0", remaining: "0" })), null, "não guardar sem plano antes");
  assert.equal(
    pausedFrom(plan({ planned: "10000", separated: "10000", remaining: "0", previous: "15000" })),
    null,
    "reduzir e separar tudo não é pausa",
  );
  assert.equal(pausedFrom(null), null);
});
