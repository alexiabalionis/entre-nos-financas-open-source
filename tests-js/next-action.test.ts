import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAction, type NextActionInput } from "../src/domain/next-action.ts";
import type { Gap } from "../src/domain/projection-confidence.ts";

const gap = (key: string, impact: bigint | "unbounded" = "unbounded"): Gap => ({
  key,
  quality: "estimated",
  impact,
  reason: key,
});

const calm: NextActionInput = {
  state: "CONFIRMADO",
  gaps: [],
  status: { kind: "free", livre: 30000n },
  overdue: [],
  overspent: [],
  receiptLate: null,
  plan: null,
  cycle: "done",
  incomeDetected: true,
  suggestion: 0n,
  capacity: null,
  today: "2026-11-10",
  until: "2026-11-30",
  declaredPending: false,
};

const make = (over: Partial<NextActionInput>): NextActionInput => ({ ...calm, ...over });

test("1 need_data escolhe a lacuna de maior prioridade", () => {
  const gaps = [gap("bill:nu:2026-11"), gap("everyday:sem-historico"), gap("income:sem-regra"), gap("saldo:itau"), gap("x", 5n)];
  const r = nextAction(make({ state: "INDETERMINADO", gaps }));
  assert.deepEqual(r, { kind: "need_data", gap: gap("saldo:itau") });
  const r2 = nextAction(make({ state: "INDETERMINADO", gaps: gaps.slice(0, 3) }));
  assert.equal(r2.kind === "need_data" && r2.gap?.key, "income:sem-regra");
  const r3 = nextAction(make({ state: "INDETERMINADO", gaps: [gap("outra"), gap("bill:a:1")] }));
  assert.equal(r3.kind === "need_data" && r3.gap?.key, "bill:a:1");
  assert.deepEqual(nextAction(make({ state: "INDETERMINADO" })), { kind: "need_data", gap: null });
});

test("1 vence 2", () => {
  const r = nextAction(make({ state: "INDETERMINADO", overdue: [{ id: "a", amount: 1n }] }));
  assert.equal(r.kind, "need_data");
});

test("2 overdue pega a de maior valor", () => {
  const r = nextAction(make({ overdue: [{ id: "a", amount: 100n }, { id: "b", amount: 900n }] }));
  assert.deepEqual(r, { kind: "overdue", item: { id: "b", amount: 900n } });
});

test("3 short por status, com no máximo 3 categorias e canPausePlan", () => {
  const overspent = ["a", "b", "c", "d"].map((category) => ({ category, over: 10n }));
  const r = nextAction(make({
    status: { kind: "short", missing: 1000n },
    overspent,
    plan: { remaining: 5000n, plan_date: "2026-11-01" },
  }));
  assert.equal(r.kind, "short");
  if (r.kind === "short") {
    assert.equal(r.missing, 1000n);
    assert.equal(r.overspent.length, 3);
    assert.equal(r.canPausePlan, true);
    assert.equal(r.until, "2026-11-30");
  }
});

test("3 short por estado SEM_FOLGA / DEPENDE_DE_DADOS", () => {
  for (const state of ["SEM_FOLGA", "DEPENDE_DE_DADOS"] as const) {
    const r = nextAction(make({ state, plan: { remaining: 0n, plan_date: "2026-11-01" } }));
    assert.deepEqual(r, { kind: "short", missing: null, until: "2026-11-30", overspent: [], canPausePlan: false });
  }
});

test("2 vence 3", () => {
  const r = nextAction(make({ overdue: [{ id: "a", amount: 1n }], status: { kind: "short", missing: 1n } }));
  assert.equal(r.kind, "overdue");
});

test("3 vence 5", () => {
  const r = nextAction(make({
    status: { kind: "short", missing: 1n },
    plan: { remaining: 5000n, plan_date: "2026-11-01" },
  }));
  assert.equal(r.kind, "short");
});

test("4 income_late", () => {
  const receipt = { id: "r", expectedDate: "2026-11-05" };
  assert.deepEqual(nextAction(make({ receiptLate: receipt })), { kind: "income_late", receipt });
});

test("5 separate só quando a data do plano chegou e não está short", () => {
  const plan = { remaining: 5000n, plan_date: "2026-11-10" };
  assert.deepEqual(nextAction(make({ plan, declaredPending: true })), {
    kind: "separate",
    remaining: 5000n,
    declaredPending: true,
  });
  assert.equal(nextAction(make({ plan: { ...plan, plan_date: "2026-11-11" } })).kind, "ok");
  assert.equal(nextAction(make({ plan: { ...plan, remaining: 0n } })).kind, "ok");
});

test("4 vence 5", () => {
  const r = nextAction(make({
    receiptLate: { id: "r", expectedDate: "2026-11-05" },
    plan: { remaining: 5000n, plan_date: "2026-11-01" },
  }));
  assert.equal(r.kind, "income_late");
});

test("6 decide só com renda, ciclo not_planned e sugestão >= 1000", () => {
  const input = make({ cycle: "not_planned", suggestion: 17000n, capacity: 34000n });
  assert.deepEqual(nextAction(input), { kind: "decide", suggestion: 17000n, capacity: 34000n });
  assert.equal(nextAction({ ...input, incomeDetected: false }).kind, "ok");
  assert.equal(nextAction({ ...input, suggestion: 999n }).kind, "ok");
  assert.equal(nextAction({ ...input, cycle: "skipped" }).kind, "ok");
  assert.equal(nextAction({ ...input, cycle: "planned" }).kind, "ok");
});

test("5 vence 6", () => {
  const r = nextAction(make({
    cycle: "not_planned",
    suggestion: 17000n,
    plan: { remaining: 5000n, plan_date: "2026-11-01" },
  }));
  assert.equal(r.kind, "separate");
});

test("7 ok", () => {
  assert.deepEqual(nextAction(calm), { kind: "ok", livre: 30000n, until: "2026-11-30" });
  assert.deepEqual(nextAction(make({ status: { kind: "zero" } })), { kind: "ok", livre: null, until: "2026-11-30" });
});
