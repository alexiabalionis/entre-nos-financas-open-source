import { test } from "node:test";
import assert from "node:assert/strict";
import type { MonthItem } from "../app/hooks/use-month-data.ts";
import {
  PLAN_GROUPS,
  itemStatusText,
  itemsInGroup,
  paidWithoutEntryCents,
  plannedTotal,
} from "../app/month/plan-model.ts";

function item(over: Partial<MonthItem>): MonthItem {
  return {
    id: "i",
    month: "2026-11",
    label: "Item",
    purpose: "expense",
    cost_type: null,
    currency: "BRL",
    planned_cents: "1000",
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
    ...over,
  } as MonthItem;
}

test("PLAN_GROUPS: quatro grupos na ordem da tela", () => {
  assert.deepEqual(
    PLAN_GROUPS.map((g) => g.id),
    ["income", "fixed", "variable", "saving"],
  );
});

test("4a: itemsInGroup classifica por propósito, série e tipo legado, nunca por categoria", () => {
  const list = [
    item({ id: "salario", purpose: "income" }),
    item({ id: "reserva", purpose: "saving" }),
    item({ id: "explicito", cost_type: "variable", category_id: "c-fixa" }),
    item({ id: "legado", cost_type: "fixed" }),
    item({ id: "cat-fixa", category_id: "c-fixa" }),
    item({ id: "moradia", category_id: "c-moradia" }),
    item({ id: "mercado", category_id: "c-mercado" }),
    item({ id: "serie", recurrence: { id: "r1" } } as Partial<MonthItem>),
  ];
  const ids = (g: (typeof PLAN_GROUPS)[number]["id"]) =>
    itemsInGroup(list, g).map((i) => i.id);
  assert.deepEqual(ids("income"), ["salario"]);
  assert.deepEqual(ids("saving"), ["reserva"]);
  assert.deepEqual(ids("fixed"), ["legado", "serie"]);
  assert.deepEqual(ids("variable"), ["explicito", "cat-fixa", "moradia", "mercado"]);
});

test("plannedTotal: planned_cents nulo conta como zero", () => {
  const list = [
    item({ planned_cents: "1000" }),
    item({ planned_cents: null }),
    item({ planned_cents: "250" }),
  ];
  assert.equal(plannedTotal(list), 1250n);
  assert.equal(plannedTotal([]), 0n);
});

test("plannedTotal paid=true: aberto 0, parcial usa paid_cents, concluído cai no planejado", () => {
  assert.equal(plannedTotal([item({ status: "open", paid_cents: "500" })], true), 0n);
  assert.equal(plannedTotal([item({ status: "partial", paid_cents: "400" })], true), 400n);
  assert.equal(plannedTotal([item({ status: "partial", paid_cents: null })], true), 0n);
  assert.equal(plannedTotal([item({ status: "done", paid_cents: null })], true), 1000n);
  assert.equal(plannedTotal([item({ status: "done", paid_cents: "900" })], true), 900n);
  assert.equal(
    plannedTotal([item({ status: "done", paid_cents: null, planned_cents: null })], true),
    0n,
  );
});

test("itemStatusText: concluído por propósito", () => {
  const today = "2026-11-10";
  assert.equal(itemStatusText(item({ status: "done", purpose: "income" }), today), "Recebido");
  assert.equal(itemStatusText(item({ status: "done", purpose: "saving" }), today), "Reservado");
  assert.equal(itemStatusText(item({ status: "done", purpose: "expense" }), today), "Pago");
});

test("itemStatusText: parcial por propósito", () => {
  const today = "2026-11-10";
  assert.equal(
    itemStatusText(item({ status: "partial", purpose: "income" }), today),
    "Recebido em parte",
  );
  assert.equal(
    itemStatusText(item({ status: "partial", purpose: "expense" }), today),
    "Pago em parte",
  );
  assert.equal(
    itemStatusText(item({ status: "partial", purpose: "saving" }), today),
    "Pago em parte",
  );
});

test("itemStatusText: aberto com vencimento passado, futuro, no dia e sem data", () => {
  const today = "2026-11-10";
  assert.equal(itemStatusText(item({ due_date: "2026-11-05" }), today), "Venceu em 05/11/2026");
  assert.equal(itemStatusText(item({ due_date: "2026-11-20" }), today), "Previsto para 20/11/2026");
  assert.equal(itemStatusText(item({ due_date: "2026-11-10" }), today), "Previsto para 10/11/2026");
  assert.equal(itemStatusText(item({ due_date: null }), today), "Sem data definida");
});

test("itemStatusText: benefício ganha sufixo", () => {
  const today = "2026-11-10";
  assert.equal(
    itemStatusText(item({ purpose: "benefit", due_date: null }), today),
    "Sem data definida · Benefício",
  );
  assert.equal(
    itemStatusText(item({ purpose: "benefit", status: "done" }), today),
    "Pago · Benefício",
  );
});

test("paidWithoutEntryCents: pago ou parcial sem evento aparece; com evento, aberto, derivado e entrada não", () => {
  assert.equal(paidWithoutEntryCents(item({ status: "partial", paid_cents: "600" })), 600n);
  assert.equal(paidWithoutEntryCents(item({ status: "done", paid_cents: "1500" })), 1500n);
  assert.equal(paidWithoutEntryCents(item({ status: "done", paid_cents: null })), 1000n);
  assert.equal(paidWithoutEntryCents(item({ purpose: "benefit", status: "done", paid_cents: "300" })), 300n);
  assert.equal(paidWithoutEntryCents(item({ status: "done", paid_cents: "1000", event_id: "e1" })), 0n);
  assert.equal(paidWithoutEntryCents(item({ status: "open" })), 0n);
  assert.equal(paidWithoutEntryCents(item({ status: "done", derived: true })), 0n);
  assert.equal(paidWithoutEntryCents(item({ purpose: "income", status: "done", paid_cents: "1000" })), 0n);
  assert.equal(paidWithoutEntryCents(item({ purpose: "card", status: "done", paid_cents: "1000" })), 0n);
});
