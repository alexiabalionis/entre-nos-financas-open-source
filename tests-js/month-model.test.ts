// Testa heroProps (app/month/hero.ts) e buildMonthModel (app/month/model.ts).
// O ícone de categoria entra por iconFor, então o modelo e os construtores de
// linha rodam aqui sem JSX (node --test não carrega .tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { heroProps } from "../app/month/hero.ts";
import { analyzeMonth } from "../app/month-analysis.ts";
import type { ProjectionView } from "../app/projection-view.ts";

function mkPv(overrides: Partial<ProjectionView> = {}): ProjectionView {
  return {
    hero: {
      availableCents: null,
      nextIncomeDate: null,
      horizonEnd: "2026-11-30",
      state: "DEPENDE_DE_DADOS",
      low: { day: "2026-11-15", cents: "500" },
    },
    flow: { firmCents: "0", estimatedCents: "0", incomingCents: "0" },
    upcoming: [],
    categories: [],
    path: [],
    gaps: [],
    start: { cents: "1000", date: "2026-11-01" },
    cash: null,
    deficit: null,
    ...overrides,
  };
}

test("heroProps: current com availableCents mostra 'Livre até DD/MM' e anima o valor", () => {
  const pv = mkPv({
    hero: {
      availableCents: "12345",
      nextIncomeDate: null,
      horizonEnd: "2026-11-28",
      state: "CONFIRMADO",
      low: { day: "2026-11-20", cents: "900" },
    },
  });
  const analysis = analyzeMonth([], "2026-11", { today: "2026-11-05" });
  const hero = heroProps({ pv, isFuture: false, month: "2026-11", analysis, currency: "BRL" });
  assert.equal(hero.eyebrow, "Livre até 28/11");
  assert.equal(hero.valueCents, "12345");
  assert.equal(hero.title, false);
  assert.equal(hero.toneLabel, "Confiável");
  assert.equal(hero.tone, "ok");
});

test("heroProps: availableCents null (INDETERMINADO) mostra a palavra do estado, sem fabricar valor", () => {
  const pv = mkPv({
    hero: {
      availableCents: null,
      nextIncomeDate: null,
      horizonEnd: "2026-11-28",
      state: "INDETERMINADO",
      low: { day: "2026-11-20", cents: "900" },
    },
  });
  const analysis = analyzeMonth([], "2026-11", { today: "2026-11-05" });
  const hero = heroProps({ pv, isFuture: false, month: "2026-11", analysis, currency: "BRL" });
  assert.equal(hero.eyebrow, "Seu mês até o salário");
  assert.equal(hero.valueCents, null);
  assert.equal(hero.valueText, "Indeterminado");
  assert.equal(hero.title, true);
  assert.equal(hero.tone, "neutral");
});

test("heroProps: future com startCents null mostra 'Sem saldo previsto', sem fabricar 0", () => {
  const pv = mkPv({
    start: { cents: null, date: null },
    hero: {
      availableCents: null,
      nextIncomeDate: null,
      horizonEnd: "2026-12-31",
      state: "COM_RESSALVA",
      low: { day: "2026-12-15", cents: "-200" },
    },
  });
  const analysis = analyzeMonth([], "2026-12", { today: "2026-11-05", status: "future" });
  const hero = heroProps({ pv, isFuture: true, month: "2026-12", analysis, currency: "BRL" });
  assert.equal(hero.eyebrow, "Saldo previsto em 01/12");
  assert.equal(hero.valueCents, null);
  assert.equal(hero.valueText, "Sem saldo previsto");
  assert.equal(hero.neg, false);
});

test("heroProps: sem projeção e cenário insuficiente pede pra preencher os valores", () => {
  const items = [
    {
      id: "1",
      month: "2026-11-01",
      label: "Sem valor",
      purpose: "expense",
      currency: "BRL",
      planned_cents: null,
      paid_cents: null,
      actual_reference_cents: null,
      status: "open",
      due_date: null,
      paid_date: null,
      notes: "",
      source_note: "",
      source_line_id: null,
      category_id: null,
      event_id: null,
      derived: false,
      version: 1,
    },
  ];
  const analysis = analyzeMonth(items, "2026-11", { today: "2026-11-05" });
  assert.equal(analysis.scenario, "insuficiente");
  const hero = heroProps({ pv: null, isFuture: false, month: "2026-11", analysis, currency: "BRL" });
  assert.equal(hero.eyebrow, "Disponível nesta semana");
  assert.equal(hero.valueText, "Informe os valores");
  assert.equal(hero.caption, "Preencha os valores em aberto para a gente projetar.");
});

test("heroProps: sem projeção e cenário risco anima a fatia semanal (nunca negativa) e usa o tom danger", () => {
  const items = [
    {
      id: "1",
      month: "2026-11-01",
      label: "Aluguel",
      purpose: "expense",
      currency: "BRL",
      planned_cents: "500000",
      paid_cents: null,
      actual_reference_cents: null,
      status: "open",
      due_date: null,
      paid_date: null,
      notes: "",
      source_note: "",
      source_line_id: null,
      category_id: null,
      event_id: null,
      derived: false,
      version: 1,
    },
    {
      id: "2",
      month: "2026-11-01",
      label: "Salário",
      purpose: "income",
      currency: "BRL",
      planned_cents: "100000",
      paid_cents: null,
      actual_reference_cents: null,
      status: "open",
      due_date: null,
      paid_date: null,
      notes: "",
      source_note: "",
      source_line_id: null,
      category_id: null,
      event_id: null,
      derived: false,
      version: 1,
    },
  ];
  const analysis = analyzeMonth(items, "2026-11", { today: "2026-11-05" });
  assert.equal(analysis.scenario, "risco");
  const hero = heroProps({ pv: null, isFuture: false, month: "2026-11", analysis, currency: "BRL" });
  assert.equal(hero.toneLabel, "Exige atenção");
  assert.equal(hero.tone, "danger");
  // risco mantém weekAvailable (fatia nunca negativa) — o valor animado é a
  // fatia, não a sobra negativa direto.
  assert.ok(hero.valueCents !== null);
});

// buildMonthModel: os casos que antes só existiam como JSX em month-screen.
import { buildMonthModel } from "../app/month/model.ts";

const iconFor = (name: string) => "icon:" + name;
const cats = [
  { id: "c-edu", name: "Educação", colorIndex: 6 },
  { id: "c-mor", name: "Moradia", colorIndex: 10 },
];
function upcoming(
  key: string,
  date: string,
  category: string | null,
  direction: "in" | "out" = "out",
) {
  return {
    key,
    date,
    label: key,
    cents: "1000",
    direction,
    quality: "scheduled" as const,
    category,
  };
}

test("modelo com projeção: Vem aí filtra pelo mês e fatura vira Cartões no ícone e na cor", () => {
  const pv = mkPv({
    upcoming: [
      upcoming("sched:a", "2026-11-16", "Moradia"),
      upcoming("bill:c:2026-11", "2026-11-26", null),
      upcoming("inc:s", "2026-11-25", null, "in"),
      upcoming("sched:dez", "2026-12-01", "Educação"),
    ],
  });
  const m = buildMonthModel({
    items: [],
    categories: cats,
    month: "2026-11",
    currency: "BRL",
    projection: pv,
    iconFor,
  });
  assert.deepEqual(
    m.upcomingRows.map((r) => [r.title, r.icon, r.catColor]),
    [
      ["sched:a", "icon:Moradia", "var(--family-cat-11)"],
      ["bill:c:2026-11", "icon:Cartões", "var(--family-cat-cards)"],
      ["inc:s", "↑", undefined],
    ],
  );
});

test("modelo com projeção e deficit: alerta de saldo negativo com dia e valor", () => {
  const m = buildMonthModel({
    items: [],
    categories: cats,
    month: "2026-11",
    currency: "BRL",
    projection: mkPv({ deficit: { cents: "274654", day: "2026-12-03" } }),
    iconFor,
  });
  assert.equal(m.riskAlert?.title, "O saldo fica negativo em 03/12");
  assert.match(m.riskAlert?.meta ?? "", /2\.746,54/);
});

test("modelo sem projeção: Vem aí vem dos itens em aberto com o ícone da categoria", () => {
  const m = buildMonthModel({
    items: [
      {
        id: "i1",
        label: "Aluguel",
        purpose: "expense",
        status: "open",
        planned_cents: "300000",
        paid_cents: null,
        due_date: "2026-11-10",
        category_id: "c-mor",
        currency: "BRL",
      } as never,
    ],
    categories: cats,
    month: "2026-11",
    currency: "BRL",
    projection: null,
    iconFor,
  });
  assert.equal(m.upcomingRows[0]?.title, "Aluguel");
  assert.equal(m.upcomingRows[0]?.icon, "icon:Moradia");
  assert.equal(m.compositionSegments[0]?.color, "var(--family-cat-11)");
});
