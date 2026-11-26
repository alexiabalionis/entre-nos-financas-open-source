import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeCategories,
  summarizeFlowBuckets,
  summarizeUpcoming,
  toProjectionView,
  visibleBlocks,
  withinHorizon,
} from "../app/projection-view.ts";
import type { ConfidenceResult } from "../src/domain/projection-confidence.ts";
import type {
  Quality,
  ReconciledFlow,
} from "../src/domain/projection-reconcile-shared.ts";

test("visibleBlocks: current, future e closed mostram tudo, sem aviso", () => {
  for (const mode of ["current", "future", "closed"] as const) {
    assert.deepEqual(visibleBlocks(mode), {
      banner: true,
      flow: true,
      upcoming: true,
      gaps: true,
      path: true,
      notice: false,
    });
  }
});

test("visibleBlocks: unavailable mostra só o aviso", () => {
  for (const mode of ["unavailable"] as const) {
    assert.deepEqual(visibleBlocks(mode), {
      banner: false,
      flow: false,
      upcoming: false,
      gaps: false,
      path: false,
      notice: true,
    });
  }
});

function mkFlow(
  key: string,
  direction: "in" | "out",
  quality: Quality,
  date: string,
  cents: bigint,
): ReconciledFlow {
  return {
    key,
    direction,
    quality,
    nom: { date, cents },
    cons: { date, cents },
    sources: [],
    explain: `explain ${key}`,
  };
}

function mkConfidence(): ConfidenceResult {
  return {
    result: {
      series: [
        { day: "2026-11-09", nom: 1000n, cons: 900n },
        { day: "2026-11-10", nom: 800n, cons: 700n },
        { day: "2026-11-11", nom: 600n, cons: 500n },
      ],
      sConf: 1000n,
      D: 100n,
      cNom: 600n,
      cCons: 400n,
      low: {
        nom: { day: "2026-11-11", cents: 600n },
        cons: { day: "2026-11-11", cents: 500n },
      },
      deficit: null,
      negative: null,
    },
    state: "COM_RESSALVA",
    shown: 400n,
    gaps: [
      { key: "a", quality: "estimated", impact: 250n, reason: "r1" },
      { key: "b", quality: "estimated", impact: "unbounded", reason: "r2" },
    ],
    needed: [],
  };
}

const TODAY = "2026-11-09";

test("toProjectionView: hero com cCons, estado e menor ponto", () => {
  const view = toProjectionView({
    confidence: mkConfidence(),
    flows: [],
    today: TODAY,
    currency: "BRL",
  });
  assert.equal(view.hero.availableCents, "400");
  assert.equal(view.hero.state, "COM_RESSALVA");
  assert.deepEqual(view.hero.low, { day: "2026-11-11", cents: "500" });
  assert.equal(view.hero.nextIncomeDate, null);
});

test("toProjectionView: path tem um ponto por DayPoint com cons em string", () => {
  const view = toProjectionView({
    confidence: mkConfidence(),
    flows: [],
    today: TODAY,
    currency: "BRL",
  });
  assert.deepEqual(view.path, [
    { day: "2026-11-09", cents: "900" },
    { day: "2026-11-10", cents: "700" },
    { day: "2026-11-11", cents: "500" },
  ]);
});

test("toProjectionView: gaps convertem impacto numérico e preservam unbounded", () => {
  const view = toProjectionView({
    confidence: mkConfidence(),
    flows: [],
    today: TODAY,
    currency: "BRL",
  });
  assert.deepEqual(view.gaps, [
    { key: "a", reason: "r1", impactCents: "250" },
    { key: "b", reason: "r2", impactCents: "unbounded" },
  ]);
});

test("summarizeFlowBuckets: confirmed conta como firme, estimado/inconsistente à parte, entradas separadas", () => {
  const flows = [
    mkFlow("o1", "out", "confirmed", "2026-11-10", 500n),
    mkFlow("o2", "out", "scheduled", "2026-11-11", 300n),
    mkFlow("o3", "out", "planned", "2026-11-12", 200n),
    mkFlow("o4", "out", "structural", "2026-11-13", 100n),
    mkFlow("o5", "out", "estimated", "2026-11-14", 60n),
    mkFlow("o6", "out", "inconsistent", "2026-11-15", 40n),
    mkFlow("i1", "in", "planned", "2026-11-20", 9000n),
  ];
  const buckets = summarizeFlowBuckets(flows);
  assert.deepEqual(buckets, {
    firmCents: "1100",
    estimatedCents: "100",
    incomingCents: "9000",
  });
  assert.equal("goneCents" in buckets, false);
});

test("summarizeUpcoming: lista todos os fluxos, qualquer quality, por data ascendente", () => {
  const flows = [
    mkFlow("c", "out", "estimated", "2026-11-25", 30n),
    mkFlow("a", "out", "confirmed", "2026-11-10", 10n),
    mkFlow("b", "in", "planned", "2026-11-15", 20n),
  ];
  const upcoming = summarizeUpcoming(flows);
  assert.deepEqual(
    upcoming.map((u) => u.key),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    upcoming.map((u) => u.quality),
    ["confirmed", "planned", "estimated"],
  );
  assert.equal(upcoming[0]?.label, "explain a");
  assert.equal(upcoming[0]?.cents, "10");
  assert.equal(upcoming[0]?.category, null);
});

test("regressão: fatura fechada (confirmed) aparece em upcoming e soma em firmCents", () => {
  const flows = [mkFlow("bill:card", "out", "confirmed", "2026-11-20", 1500n)];
  const upcoming = summarizeUpcoming(flows);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0]?.key, "bill:card");
  assert.equal(upcoming[0]?.date, "2026-11-20");
  assert.equal(upcoming[0]?.cents, "1500");
  assert.equal(summarizeFlowBuckets(flows).firmCents, "1500");
});

test("summarizeUpcoming: não muta o array de entrada", () => {
  const flows = [
    mkFlow("c", "out", "planned", "2026-11-25", 30n),
    mkFlow("a", "out", "planned", "2026-11-10", 10n),
  ];
  const before = flows.map((f) => f.key);
  summarizeUpcoming(flows);
  assert.deepEqual(
    flows.map((f) => f.key),
    before,
  );
});

test("withinHorizon: remove depois de horizonEnd e mantém o próprio dia", () => {
  const flows = [
    mkFlow("before", "out", "planned", "2026-11-29", 1n),
    mkFlow("edge", "out", "planned", "2026-11-30", 2n),
    mkFlow("after", "out", "planned", "2026-12-01", 3n),
  ];
  const kept = withinHorizon(flows, "2026-11-30");
  assert.deepEqual(
    kept.map((f) => f.key),
    ["before", "edge"],
  );
});

test("summarizeCategories: agrupa saídas, fatura sem categoria vira Cartões, resto Sem categoria, maior primeiro", () => {
  const withCat = (
    f: ReconciledFlow,
    category: string | null,
  ): ReconciledFlow & { category: string | null } => ({ ...f, category });
  const flows = [
    withCat(mkFlow("o1", "out", "planned", "2026-11-10", 100n), "Mercado"),
    withCat(mkFlow("o2", "out", "planned", "2026-11-11", 50n), "Mercado"),
    withCat(mkFlow("o3", "out", "planned", "2026-11-12", 70n), null),
    withCat(mkFlow("bill:x", "out", "confirmed", "2026-11-13", 300n), null),
    withCat(mkFlow("i1", "in", "planned", "2026-11-14", 999n), "Salário"),
  ];
  assert.deepEqual(summarizeCategories(flows), [
    { label: "Cartões", cents: "300" },
    { label: "Mercado", cents: "150" },
    { label: "Sem categoria", cents: "70" },
  ]);
});

import { inMonth } from "../app/projection-view.ts";

test("inMonth: mantém só fluxos com data conservadora dentro do mês (inclusive nas bordas)", () => {
  const flows = [
    mkFlow("a", "out", "planned", "2026-10-31", 1n),
    mkFlow("b", "out", "planned", "2026-11-01", 2n),
    mkFlow("c", "out", "planned", "2026-11-30", 3n),
    mkFlow("d", "out", "planned", "2026-12-01", 4n),
  ];
  assert.deepEqual(
    inMonth(flows, "2026-11-01", "2026-11-30").map((f) => f.key),
    ["b", "c"],
  );
});

test("inMonth: não muta a entrada e devolve vazio quando nada cai no mês", () => {
  const flows = [mkFlow("a", "in", "planned", "2026-12-05", 1n)];
  assert.deepEqual(inMonth(flows, "2026-11-01", "2026-11-30"), []);
  assert.equal(flows.length, 1);
});
