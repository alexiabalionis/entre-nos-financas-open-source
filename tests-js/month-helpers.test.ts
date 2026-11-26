import { test } from "node:test";
import assert from "node:assert/strict";
import { ddmm, monthLabel, toReais, toWholeReais } from "../app/month/format.ts";
import { CARDS_LABEL, NO_CATEGORY_LABEL, categoryColor, flowCategory } from "../app/month/palette.ts";
import { confidenceTone, gapHref, gapSentence, lowDayCaption } from "../app/month/copy.ts";
import { gapRows } from "../app/month/rows.ts";
import { wireToView } from "../app/projection-view.ts";
import type { ProjectionMonthWire, ProjectionFlowWire } from "../src/server/projection.ts";

test("ddmm/monthLabel: extraem DD/MM e o rótulo pt-BR capitalizado", () => {
  assert.equal(ddmm("2026-11-09"), "09/11");
  assert.equal(monthLabel("2026-11"), "Novembro de 2026");
});

test("toReais/toWholeReais: mesma entrada, semânticas diferentes (exata vs truncada)", () => {
  // 1234 centavos = R$ 12,34: toReais preserva, toWholeReais trunca pra 12.
  assert.equal(toReais("1234"), 12.34);
  assert.equal(toWholeReais("1234"), 12);
  // Negativo: toReais preserva o sinal, toWholeReais trunca em direção a zero.
  assert.equal(toReais("-150"), -1.5);
  assert.equal(toWholeReais("-150"), -1);
});

test("flowCategory: fatura de cartão vira Cartões; sem categoria e sem bill vira null", () => {
  assert.equal(flowCategory({ key: "bill:card1:2026-11", category: null }), CARDS_LABEL);
  assert.equal(flowCategory({ key: "item:1", category: "Mercado" }), "Mercado");
  assert.equal(flowCategory({ key: "sched:1", category: null }), null);
});

test("categoryColor: Cartões tem token próprio; categoria sem índice cai no token 'none'", () => {
  const byName = new Map<string, number | null>([["Mercado", 2]]);
  assert.equal(categoryColor(CARDS_LABEL, byName), "var(--family-cat-cards)");
  assert.equal(categoryColor("Mercado", byName), "var(--family-cat-3)");
  assert.equal(categoryColor(NO_CATEGORY_LABEL, byName), "var(--family-cat-none)");
});

test("confidenceTone: mapeia os 5 estados do motor pro tom do DS", () => {
  assert.equal(confidenceTone("CONFIRMADO"), "ok");
  assert.equal(confidenceTone("SEM_FOLGA"), "danger");
  assert.equal(confidenceTone("INDETERMINADO"), "neutral");
  assert.equal(confidenceTone("COM_RESSALVA"), "warn");
  assert.equal(confidenceTone("DEPENDE_DE_DADOS"), "warn");
});

test("lowDayCaption: 'No pior dia (DD/MM), o saldo chega a R$ X.'", () => {
  assert.equal(
    lowDayCaption({ day: "2026-11-20", cents: "-500" }, "BRL"),
    "No pior dia (20/11), o saldo chega a R$ -5,00.",
  );
});

test("gapSentence: uma frase por tipo de lacuna", () => {
  assert.match(
    gapSentence({ key: "k", kind: "income", reason: "", impactCents: "unbounded" }, null, "BRL"),
    /salário entra/,
  );
  assert.match(
    gapSentence({ key: "k", kind: "bill", reason: "", impactCents: "300" }, null, "BRL"),
    /fatura ainda não fechou/,
  );
  assert.match(
    gapSentence({ key: "k", kind: "stale-balance", reason: "", impactCents: "300" }, "2026-11-01", "BRL"),
    /O saldo das contas é de 01\/11/,
  );
  assert.match(
    gapSentence({ key: "k", kind: "stale-balance", reason: "", impactCents: "300" }, null, "BRL"),
    /pode estar desatualizado/,
  );
  assert.equal(
    gapSentence({ key: "k", kind: "other", reason: "motivo x", impactCents: "0" }, null, "BRL"),
    "motivo x",
  );
});

function mkFlow(overrides: Partial<ProjectionFlowWire>): ProjectionFlowWire {
  return {
    key: "item:1",
    direction: "out",
    nom: { date: "2026-11-05", cents: "1000" },
    cons: { date: "2026-11-05", cents: "1000" },
    quality: "planned",
    sources: [],
    explain: "explain",
    label: "Item",
    category: "Casa",
    ...overrides,
  };
}

function mkWire(overrides: Partial<ProjectionMonthWire>): ProjectionMonthWire {
  return {
    mode: "current",
    statusWord: "Confiável",
    monthStart: "2026-11-01",
    monthEnd: "2026-11-30",
    startCents: "1000",
    today: "2026-11-05",
    horizonEnd: "2026-11-20",
    sConf: "1000",
    snapshotDate: "2026-11-05",
    state: "CONFIRMADO",
    shown: "900",
    nextIncomeDate: null,
    gaps: [],
    needed: [],
    flows: [],
    series: [{ day: "2026-11-05", nom: "1000", cons: "1000" }],
    low: { nom: { day: "2026-11-05", cents: "1000" }, cons: { day: "2026-11-05", cents: "1000" } },
    deficit: null,
    ...overrides,
  } as ProjectionMonthWire;
}

test("wireToView: mês errado devolve null", () => {
  assert.equal(wireToView(mkWire({ monthStart: "2026-10-01" }), "2026-11"), null);
});

test("wireToView: modo closed (ou unavailable) devolve null mesmo com o mês certo", () => {
  assert.equal(
    wireToView({ mode: "closed", statusWord: "Realizado", monthStart: "2026-11-01", monthEnd: "2026-11-30" }, "2026-11"),
    null,
  );
});

test("wireToView: current recorta pelo horizonte e pelo mês pedido", () => {
  const wire = mkWire({
    flows: [
      mkFlow({ key: "item:in-month", cons: { date: "2026-11-05", cents: "1000" }, category: "Casa" }),
      mkFlow({ key: "item:after-horizon", cons: { date: "2026-11-25", cents: "2000" }, category: "Casa" }),
      mkFlow({ key: "item:before-month", cons: { date: "2026-10-31", cents: "3000" }, category: "Casa" }),
    ],
  });
  const view = wireToView(wire, "2026-11");
  assert.ok(view);
  // Só o fluxo dentro do horizonte (<=20/11) E do mês (>=01/11) entra.
  assert.deepEqual(view!.categories, [{ label: "Casa", cents: "1000" }]);
  assert.deepEqual(
    view!.upcoming.map((u) => u.key),
    ["item:in-month"],
  );
});

test("gapHref: destino por tipo de lacuna", () => {
  assert.equal(gapHref("stale-balance"), "/espaco?painel=banks");
  assert.equal(gapHref("income"), "/espaco?painel=banks");
  assert.equal(gapHref("bill"), "/");
  assert.equal(gapHref("other"), undefined);
});

test("gapRows: cada linha leva o href do seu tipo de lacuna", () => {
  const rows = gapRows(
    [
      { key: "income:x", reason: "", impactCents: "unbounded" },
      { key: "stale:saldo:1", reason: "", impactCents: "500" },
      { key: "bill:2", reason: "", impactCents: "400" },
      { key: "zzz", reason: "Confira isto", impactCents: "300" },
    ],
    "BRL",
  );
  assert.deepEqual(
    rows.map((r) => r.href),
    ["/espaco?painel=banks", "/espaco?painel=banks", "/", undefined],
  );
});
