import { test } from "node:test";
import assert from "node:assert/strict";
import { paceText, weekRows, weeklyBudget } from "../app/copilot/pace.ts";
import { moneyOf } from "../app/copilot/money.ts";
import type { CopilotWire } from "../src/server/copilot.ts";

const money = moneyOf(false);

function wire(p: Partial<CopilotWire>): CopilotWire {
  return {
    today: "2026-11-10",
    until: "2026-11-23",
    state: "COM_RESSALVA",
    livre: "488658",
    daysLeft: 14,
    usualWeekly: "180000",
    weeks: [
      { from: "2026-11-10", to: "2026-11-16", bills: "13860" },
      { from: "2026-11-17", to: "2026-11-23", bills: "0" },
    ],
    ...p,
  } as CopilotWire;
}

test("livre dividido igualmente pelas semanas, com o ritmo de sempre ao lado", () => {
  // 4.886,58 em 14 dias: 2.443,29 por semana -> R$ 2.440.
  assert.equal(weeklyBudget(wire({})), 244000n);
  assert.equal(
    paceText(wire({}), money),
    "Até 23/11: R$ 2.440,00 por semana para o dia a dia. Vocês costumam gastar R$ 1.800,00 por semana.",
  );
  assert.equal(
    paceText(wire({ usualWeekly: null }), money),
    "Até 23/11: R$ 2.440,00 por semana para o dia a dia.",
  );
});

test("menos de uma semana: total; sem livre: avisa da margem", () => {
  assert.match(
    paceText(wire({ daysLeft: 5, livre: "21050" }), money)!,
    /^Até 23\/11: cabem R\$ 210,00 no dia a dia\./,
  );
  assert.equal(
    paceText(wire({ livre: "-1000" }), money),
    "Até 23/11 não sobra para o dia a dia sem usar a margem.",
  );
  assert.equal(paceText(wire({ state: "INDETERMINADO" }), money), null);
});

test("semanas: dia a dia igual + contas da semana; a semana com conta pesa mais", () => {
  const rows = weekRows(wire({}), money);
  assert.deepEqual(
    rows.map((r) => [r.title, r.sub, r.trail]),
    [
      ["10/11 a 16/11", "dia a dia R$ 2.440,00 + contas R$ 138,60", "R$ 2.578,60"],
      ["17/11 a 23/11", "dia a dia R$ 2.440,00", "R$ 2.440,00"],
    ],
  );
});
