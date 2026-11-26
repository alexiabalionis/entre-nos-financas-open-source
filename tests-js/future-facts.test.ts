import { test } from "node:test";
import assert from "node:assert/strict";
import { UserError } from "../src/server/imports.ts";
import {
  narrateScenario,
  scenarioIntent,
  toScenario,
} from "../src/server/future-simulate.ts";
import { buildGoalNeedFacts } from "../src/domain/future-facts.ts";
import type { FutureInput, GoalFuture } from "../src/domain/future-months.ts";

const goal = (over: Partial<GoalFuture>): GoalFuture => ({
  id: "id-" + (over.name ?? "x"),
  name: "Viagem",
  status: "active",
  location: null,
  target: 120000n,
  saved: 20000n,
  deadlineMonth: "2027-05",
  priority: 1,
  plans: [],
  ...over,
});
const inputWith = (goals: GoalFuture[]): FutureInput => ({
  today: "2026-11-10",
  startMonth: "2026-11",
  months: 12,
  startBalance: 0n,
  snapshotDate: null,
  income: [],
  fixed: [],
  everyday: { weekly: null, source: "ausente" },
  cards: [],
  goals,
  essentialsMonthly: 0n,
});

test("buildGoalNeedFacts: normal, reached, overdue, ignored goals, no id", () => {
  const facts = buildGoalNeedFacts(
    inputWith([
      goal({ name: "Normal" }),
      goal({ name: "Pronta", saved: 120000n }),
      goal({ name: "Vencida", deadlineMonth: "2026-10" }),
      goal({ name: "Pausada", status: "paused" }),
      goal({ name: "SemPrazo", deadlineMonth: null }),
    ]),
  );
  assert.deepEqual(
    facts.map((f) => f.name),
    ["Normal", "Pronta", "Vencida"],
  );
  // (120000-20000)/6 = 16666,67 -> sobe para reais inteiros: 16700
  assert.equal(facts[0].needed_monthly_cents, "16700");
  assert.equal(facts[0].months_left, 6);
  assert.equal(facts[1].reached, true);
  assert.equal(facts[1].needed_monthly_cents, "0");
  assert.equal(facts[1].overdue, false);
  assert.equal(facts[2].overdue, true);
  assert.equal(facts[2].needed_monthly_cents, null);
  assert.equal(facts[0].is_a_projection_not_a_promise, true);
  for (const f of facts) assert.equal("id" in f, false);
});

test("narrateScenario opens with the no-save notice and handles empty diff", () => {
  const empty = narrateScenario(["Premissa"], []);
  assert.ok(empty.startsWith("Simulação, nada foi salvo."));
  assert.match(empty, /não muda o resultado/);
  const full = narrateScenario(
    [],
    [
      {
        id: "a",
        label: "Viagem completa",
        before: "mai/27",
        after: "nov/27",
        sense: -1,
        delta: "+6 meses",
      },
    ],
  );
  assert.match(full, /Viagem completa: mai\/27 → nov\/27 \(\+6 meses\)/);
});

test("toScenario: rejects bad refs and months out of horizon, uses bigint cents", () => {
  const input = inputWith([goal({ name: "A", id: "ga" })]);
  const catalog = [{ id: "ga" }];
  const ok = toScenario(
    scenarioIntent.parse({
      contributions: [
        { goal: "g0", from_month: "2026-12", months: 3, amount_cents: "5000" },
      ],
    }),
    catalog,
    input,
  );
  assert.equal(ok.contributions?.[0].cents, 5000n);
  assert.equal(ok.contributions?.[0].goalId, "ga");
  assert.throws(
    () =>
      toScenario(
        scenarioIntent.parse({
          pauses: [{ goal: "g7", from_month: "2026-12", months: 2 }],
        }),
        catalog,
        input,
      ),
    UserError,
  );
  assert.throws(
    () =>
      toScenario(
        scenarioIntent.parse({
          pauses: [{ goal: "g0", from_month: "2030-01", months: 2 }],
        }),
        catalog,
        input,
      ),
    /próximos 12 meses/,
  );
  assert.throws(
    () =>
      toScenario(
        scenarioIntent.parse({
          pauses: [{ goal: "g0", from_month: "2026-10", months: 2 }],
        }),
        catalog,
        input,
      ),
    UserError,
  );
  assert.equal(scenarioIntent.safeParse({}).success, false);
  assert.equal(
    scenarioIntent.safeParse({
      type: "plan_create",
      everyday_weekly_cents: "100",
    }).success,
    false,
  );
});
