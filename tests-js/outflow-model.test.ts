import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listSummary,
  NO_CATEGORY,
  outflowRows,
  outflowSegments,
  outflowTotals,
  REST_KEY,
  splitOutflow,
} from "../app/budgets/outflow-model.ts";

const out = (id: string | null, spent: number, open = 0, scheduled = 0) => ({
  category_id: id,
  spent_cents: String(spent),
  open_planned_cents: String(open),
  committed_cents: String(spent + open),
  scheduled_cents: String(scheduled),
});
const budget = (id: string, name: string, ceiling: number, spent: number, open = 0) => ({
  category_id: id,
  category_name: name,
  planned_cents: String(ceiling),
  spent_cents: String(spent),
  remaining_cents: String(ceiling - spent),
  ceiling_from: "2026-09-01",
  open_planned_cents: String(open),
  committed_cents: String(spent + open),
  over: spent + open > ceiling,
});
const cat = (id: string, name: string, color_index: number | null) => ({
  id,
  name,
  essential: false,
  fixed: false,
  color_index,
});

const state = {
  categories: [
    cat("mo", "Moradia", 0),
    cat("tr", "Transporte", 3),
    cat("sa", "Saúde", 4),
    cat("la", "Lazer", 2),
  ],
  outflow: [out("mo", 270000, 61200), out("tr", 46500), out("sa", 18000, 12000), out(null, 9800)],
  budgets: [
    budget("mo", "Moradia", 350000, 270000, 61200),
    budget("tr", "Transporte", 40000, 46500),
    budget("la", "Lazer", 60000, 0),
  ],
} as unknown as Parameters<typeof outflowRows>[0];

test("outflowRows: passou primeiro, depois por tamanho; teto sem gasto aparece com 0", () => {
  const rows = outflowRows(state);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Transporte", "Moradia", "Saúde", NO_CATEGORY, "Lazer"],
  );
  assert.equal(rows[0].card?.state, "passou");
  assert.equal(rows.at(-1)?.committed, 0n);
  assert.equal(rows.at(-1)?.card?.state, "dentro");
});

test("outflowRows: mesmo número do teto; cor fixa; percentuais somam 100", () => {
  const rows = outflowRows(state);
  const moradia = rows.find((r) => r.name === "Moradia")!;
  assert.equal(moradia.committed, 331200n);
  assert.equal(moradia.committed, BigInt(moradia.card!.ceiling - moradia.card!.free));
  assert.equal(moradia.color, "var(--family-cat-1)");
  assert.equal(rows.find((r) => r.categoryId === null)?.color, "var(--family-cat-none)");
  assert.equal(rows.find((r) => r.name === "Saúde")?.card, null);
  assert.equal(rows.reduce((s, r) => s + r.percent, 0), 100);
});

test("outflowTotals: já gastou vem do total do mês; ainda vai pagar soma o previsto em aberto", () => {
  const totals = outflowTotals({
    ...state,
    summary: { expense_cents: "344300" },
  } as unknown as Parameters<typeof outflowTotals>[0]);
  assert.equal(totals.spent, 344300n);
  assert.equal(totals.open, 61200n + 12000n);
});

test("outflowTotals: Pix agendado sai do já gastou e fica no ainda vai pagar", () => {
  const totals = outflowTotals({
    outflow: [out("edu", 0, 45000, 45000), out("casa", 30000, 23000)],
    summary: { expense_cents: "75000" },
  } as unknown as Parameters<typeof outflowTotals>[0]);
  assert.equal(totals.spent, 30000n);
  assert.equal(totals.open, 68000n);
});

test("listSummary: conta categorias e avisa quantas passaram ou vão passar", () => {
  const rows = outflowRows(state);
  assert.equal(listSummary(rows), "Ver as 5 categorias · 1 passou ou vai passar do teto");
  assert.equal(listSummary(rows.filter((r) => r.card?.state !== "passou")), "Ver as 4 categorias");
});

const fake = (key: string, cents: number, percent: number, state?: string) =>
  ({
    key,
    categoryId: key,
    name: key,
    color: "c",
    committed: BigInt(cents),
    spent: BigInt(cents),
    open: 0n,
    percent,
    card: state ? { state } : null,
  }) as unknown as ReturnType<typeof outflowRows>[number];

test("splitOutflow: 5 maiores com 5%+, quem passou do teto sempre fica; resto vira Outras", () => {
  const rows = [
    fake("pequena-passou", 100, 1, "passou"),
    fake("a", 2000, 20),
    fake("b", 1600, 16),
    fake("c", 1400, 14),
    fake("d", 1000, 10),
    fake("e", 1000, 10),
    fake("f", 800, 8),
    fake("g", 400, 4),
    fake("h", 100, 1),
  ];
  const { main, rest } = splitOutflow(rows);
  assert.deepEqual(main.map((r) => r.key), ["pequena-passou", "a", "b", "c", "d", "e"]);
  assert.deepEqual(rest.map((r) => r.key), ["f", "g", "h"]);
  const segs = outflowSegments(main, rest);
  assert.equal(segs.at(-1)?.key, REST_KEY);
  assert.equal(segs.at(-1)?.value, 1300);
});

test("splitOutflow: uma categoria sozinha não vira Outras", () => {
  const rows = [fake("a", 9000, 90), fake("b", 600, 6), fake("c", 400, 4)];
  assert.equal(splitOutflow(rows).rest.length, 0);
});
