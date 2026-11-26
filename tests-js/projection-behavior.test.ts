import { test } from "node:test";
import assert from "node:assert/strict";
import {
  behavior,
  type BehaviorInput,
  type Decision,
} from "../src/domain/projection-behavior.ts";

function decision(
  partial: Partial<Decision> & { key: string; day: string },
): Decision {
  return {
    cents: 0n,
    planned: 0n,
    status: "active",
    adjustments: [],
    ...partial,
  };
}

// Fixture da spec v3: período 2026-11-09..2026-12-04, D_P 26,
// releaseP 74262 (= cCons da fixture F), A 74262.
const period = { start: "2026-11-09", end: "2026-12-04" };
const base: BehaviorInput = {
  period,
  today: "2026-11-09",
  A: 74262n,
  releaseP: 74262n,
  weeklyCap: null,
  leftover: "redistribuir",
  weekStartA: 74262n,
  decisions: [],
};

function assertInvariants(r: ReturnType<typeof behavior>, A: bigint) {
  assert.ok(r.week.remaining >= 0n, "remaining >= 0");
  assert.ok(r.week.remaining <= r.week.E, "remaining <= E");
  assert.ok(r.poolRem <= A, "poolRem <= A");
  assert.ok(r.U >= 0n, "U >= 0");
}

test("E1 = floor(74262*7/26) = 19993 na primeira semana sem gastos", () => {
  const r = behavior(base);
  assert.equal(r.week.start, "2026-11-09");
  assert.equal(r.week.end, "2026-11-15");
  assert.equal(r.week.E, 19993n);
  assert.equal(r.spentP, 0n);
  assert.equal(r.poolRem, 74262n);
  assert.equal(r.week.remaining, 19993n);
  assert.equal(r.week.capped, false);
  assertInvariants(r, base.A);
});

test("Pix e cartão da mesma decisão dão o mesmo spentP e poolRem", () => {
  const pix = behavior({
    ...base,
    decisions: [decision({ key: "pix", day: "2026-11-09", cents: 60000n })],
  });
  const card = behavior({
    ...base,
    decisions: [decision({ key: "card", day: "2026-11-14", cents: 60000n })],
  });
  assert.equal(pix.spentP, 60000n);
  assert.equal(card.spentP, 60000n);
  assert.equal(pix.poolRem, 14262n);
  assert.equal(card.poolRem, 14262n);
});

test("E2 = floor(14262*7/19) = 5254 na segunda 11-16 com 60000 gastos antes", () => {
  const r = behavior({
    ...base,
    today: "2026-11-16",
    weekStartA: 14262n,
    decisions: [decision({ key: "pix", day: "2026-11-09", cents: 60000n })],
  });
  assert.equal(r.week.start, "2026-11-16");
  assert.equal(r.week.end, "2026-11-22");
  assert.equal(r.week.E, 5254n);
  assert.equal(r.poolRem, 14262n);
  assert.equal(r.week.spent, 0n);
  assert.equal(r.week.remaining, 5254n);
  assertInvariants(r, 14262n);
});

test("parcelada 3x300 consome 90000 de uma vez; commitmentTotal 90000", () => {
  const r = behavior({
    ...base,
    A: 200000n,
    releaseP: 200000n,
    weekStartA: 200000n,
    decisions: [decision({ key: "parc", day: "2026-11-09", cents: 90000n })],
  });
  assert.equal(r.spentP, 90000n);
  assert.equal(r.commitmentTotal, 90000n);
  assert.equal(r.poolRem, 110000n);
  assert.equal(r.week.spent, 90000n);
});

test("parte planned não consome o discricionário", () => {
  const r = behavior({
    ...base,
    decisions: [
      decision({
        key: "conta",
        day: "2026-11-09",
        cents: 50000n,
        planned: 50000n,
      }),
    ],
  });
  assert.equal(r.spentP, 0n);
  // commitmentTotal é medida separada e inclui o cheio.
  assert.equal(r.commitmentTotal, 50000n);
  assert.equal(r.poolRem, 74262n);
});

test("decisão cancelada não conta em nada", () => {
  const r = behavior({
    ...base,
    decisions: [
      decision({
        key: "x",
        day: "2026-11-09",
        cents: 60000n,
        status: "cancelled",
      }),
    ],
  });
  assert.equal(r.spentP, 0n);
  assert.equal(r.commitmentTotal, 0n);
  assert.equal(r.poolRem, 74262n);
});

test("estorno linked na mesma semana abate spentWeek e spentP", () => {
  const r = behavior({
    ...base,
    decisions: [
      decision({
        key: "compra",
        day: "2026-11-10",
        cents: 60000n,
        adjustments: [{ day: "2026-11-12", cents: 20000n, linked: true }],
      }),
    ],
  });
  assert.equal(r.spentP, 40000n);
  assert.equal(r.week.spent, 40000n);
  assert.equal(r.poolRem, 34262n);
});

test("estorno linked em outra semana abate o pool mas não o spentWeek da compra", () => {
  // Compra na semana 1; hoje na semana 2; estorno na semana 2.
  const r = behavior({
    ...base,
    today: "2026-11-16",
    weekStartA: 14262n,
    decisions: [
      decision({
        key: "compra",
        day: "2026-11-10",
        cents: 60000n,
        adjustments: [{ day: "2026-11-18", cents: 20000n, linked: true }],
      }),
    ],
  });
  // spentP do período cai pelos 20000 (estorno no período).
  assert.equal(r.spentP, 40000n);
  // spentWeek da semana atual: a compra não é desta semana; só o estorno
  // (linked, nesta semana) abate -> -20000.
  assert.equal(r.week.spent, -20000n);
  // pool reflete releaseP - spentP = 74262 - 40000 = 34262.
  assert.equal(r.poolRem, 34262n);
});

test("A abaixo de releaseP-spent -> capped e remaining limitado pelo pool", () => {
  // releaseP 74262, nenhum gasto, mas A atual só 10000.
  const r = behavior({
    ...base,
    A: 10000n,
    weekStartA: 74262n,
  });
  assert.equal(r.week.E, 19993n);
  assert.equal(r.poolRem, 10000n);
  assert.equal(r.week.remaining, 10000n);
  assert.equal(r.week.capped, true);
  assertInvariants(r, 10000n);
});

test("A sobe no meio da semana -> E igual (depende só de weekStartA), U sobe", () => {
  const low = behavior({ ...base, A: 74262n, weekStartA: 74262n });
  const high = behavior({ ...base, A: 120000n, weekStartA: 74262n });
  assert.equal(low.week.E, high.week.E);
  assert.equal(high.poolRem, 74262n);
  assert.ok(high.U > low.U, "U sobe quando A sobe");
  assert.equal(high.U, 120000n - 74262n);
});

test("preservar com cap 15000 -> E = min(E, floor(15000*7/7))", () => {
  const r = behavior({
    ...base,
    leftover: "preservar",
    weeklyCap: 15000n,
  });
  // floor(15000*7/7) = 15000 < 19993 -> E = 15000.
  assert.equal(r.week.E, 15000n);
});

test("cCons negativo (A 0) -> poolRem 0, E 0, remaining 0; excessP positivo ao gastar", () => {
  const r = behavior({
    ...base,
    A: 0n,
    weekStartA: 0n,
    releaseP: 74262n,
    decisions: [decision({ key: "g", day: "2026-11-09", cents: 90000n })],
  });
  assert.equal(r.poolRem, 0n);
  assert.equal(r.week.E, 0n);
  assert.equal(r.week.remaining, 0n);
  // spentP 90000 > releaseP 74262 -> excessP = 15738.
  assert.equal(r.excessP, 15738n);
  assertInvariants(r, 0n);
});
