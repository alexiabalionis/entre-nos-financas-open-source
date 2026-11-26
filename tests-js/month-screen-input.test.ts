import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceCentsFor,
  monthCategories,
  projectionScreen,
} from "../app/month/screen-input.ts";
import type { ProjectionMonthWire } from "../src/server/projection.ts";

// Wire mínimo em modo current/future: só os campos que projectionScreen/
// wireToView de fato leem (series/flows/gaps/needed vazios bastam — o teste
// aqui é sobre a DECISÃO de mês/modo, não sobre o conteúdo da projeção).
function mkCurrentWire(monthStart: string, monthEnd: string): ProjectionMonthWire {
  return {
    mode: "current",
    statusWord: "Confiável",
    monthStart,
    monthEnd,
    startCents: "10000",
    today: monthStart,
    horizonEnd: monthEnd,
    sConf: "10000",
    snapshotDate: monthStart,
    accounts: [],
    state: "CONFIRMADO",
    shown: "10000",
    nextIncomeDate: null,
    gaps: [],
    needed: [],
    flows: [],
    series: [{ day: monthStart, nom: "10000", cons: "10000" }],
    low: {
      nom: { day: monthStart, cents: "10000" },
      cons: { day: monthStart, cents: "10000" },
    },
    deficit: null,
  };
}

function mkClosedWire(monthStart: string, monthEnd: string): ProjectionMonthWire {
  return { mode: "closed", statusWord: "Realizado", monthStart, monthEnd };
}

test("projectionScreen: projeção de outro mês não é confiada (view null)", () => {
  const wire = mkCurrentWire("2026-10-01", "2026-10-31");
  const screen = projectionScreen(wire, "2026-11", false, "2026-11-10");
  assert.equal(screen.view, null);
});

test("projectionScreen: mês encerrado (closed) devolve view null e mode closed", () => {
  const wire = mkClosedWire("2026-10-01", "2026-10-31");
  const screen = projectionScreen(wire, "2026-10", false, "2026-11-10");
  assert.equal(screen.view, null);
  assert.equal(screen.mode, "closed");
  assert.equal(screen.statusWord, "Realizado");
});

test("projectionScreen: projeção falhou (null) com mês 2+ à frente cai em mode unavailable", () => {
  // hoje=2026-11-10 (mês atual 2026-11); mês seguinte seria 2026-12 (future).
  // 2027-02 está 2+ meses à frente do seguinte -> unavailable.
  const screen = projectionScreen(null, "2027-02", false, "2026-11-10");
  assert.equal(screen.view, null);
  assert.equal(screen.mode, "unavailable");
});

test("projectionScreen: projeção falhou mas a busca ainda está em voo não deriva modo (evita aviso precoce)", () => {
  const screen = projectionScreen(null, "2027-02", true, "2026-11-10");
  assert.equal(screen.mode, undefined);
});

test("balanceCentsFor: soma só as contas na moeda pedida", () => {
  const accounts = [
    { currency: "BRL" as const, balance_cents: "10000" },
    { currency: "BRL" as const, balance_cents: "2500" },
    { currency: "USD" as const, balance_cents: "99999" },
  ];
  assert.equal(balanceCentsFor(accounts, "BRL"), "12500");
  assert.equal(balanceCentsFor(accounts, "USD"), "99999");
});

test("balanceCentsFor: null quando nenhuma conta tem saldo conhecido na moeda pedida", () => {
  assert.equal(balanceCentsFor([], "BRL"), null);
  assert.equal(
    balanceCentsFor([{ currency: "BRL" as const, balance_cents: null }], "BRL"),
    null,
  );
  assert.equal(
    balanceCentsFor([{ currency: "USD" as const, balance_cents: "500" }], "BRL"),
    null,
  );
});

test("balanceCentsFor: não fabrica 0 — ignora contas de outra moeda mesmo com saldo", () => {
  const accounts = [
    { currency: "USD" as const, balance_cents: "500" },
    { currency: "BRL" as const, balance_cents: null },
  ];
  assert.equal(balanceCentsFor(accounts, "BRL"), null);
});

test("monthCategories: mapeia color_index (snake_case) para colorIndex", () => {
  const categories = monthCategories([
    { id: "c1", name: "Mercado", color_index: 3 },
    { id: "c2", name: "Transporte", color_index: null },
  ]);
  assert.deepEqual(categories, [
    { id: "c1", name: "Mercado", colorIndex: 3 },
    { id: "c2", name: "Transporte", colorIndex: null },
  ]);
});
