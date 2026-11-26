import { test } from "node:test";
import assert from "node:assert/strict";
import { cashCard } from "../app/month/cash.ts";
import type { ProjectionView } from "../app/projection-view.ts";

function pv(cash: ProjectionView["cash"], startCents = "840000", horizonEnd = "2026-11-24"): ProjectionView {
  return {
    hero: { availableCents: null, nextIncomeDate: null, horizonEnd, state: "CONFIRMADO", low: { day: horizonEnd, cents: "0" } },
    flow: { firmCents: "0", estimatedCents: "0", incomingCents: "0" },
    upcoming: [],
    categories: [],
    path: [],
    gaps: [],
    start: { cents: startCents, date: "2026-11-19" },
    cash,
    deficit: null,
  };
}

const cash = {
  today: "2026-11-21",
  payDate: "2026-11-25",
  accounts: [
    { id: "a", name: "Nubank", cents: "500000", date: "2026-11-21" },
    { id: "b", name: "Itaú", cents: "340000", date: "2026-11-19" },
  ],
  scheduledOutCents: "300000",
};

test("cashCard: total, dias até o pagamento e por dia/semana depois das contas", () => {
  const c = cashCard(pv(cash), "BRL", false)!;
  assert.equal(c.eyebrow, "Até 24/11");
  assert.equal(c.totalCents, "840000");
  assert.equal(c.caption, "Faltam 4 dias para o pagamento");
  assert.equal(c.updated, "atualizado em 19/11");
  // (8.400 - 3.000) / 4 dias (21 a 24) = 1.350; menos de uma semana: valor inteiro.
  assert.equal(c.perDay, "R$ 1.350,00");
  assert.equal(c.perWeek, "R$ 5.400,00");
  assert.equal(c.scheduled, "R$ 3.000,00");
  assert.deepEqual(c.accounts.map((a) => a.name), ["Nubank", "Itaú"]);
});

test("cashCard: semanas restantes arredondam para cima", () => {
  const c = cashCard(pv({ ...cash, payDate: "2026-12-01" }, "840000", "2026-11-30"), "BRL", false)!;
  // 21/11 a 30/11 = 10 dias = 2 semanas.
  assert.equal(c.perDay, "R$ 540,00");
  assert.equal(c.perWeek, "R$ 2.700,00");
  assert.equal(c.caption, "Faltam 10 dias para o pagamento");
});

test("cashCard: valores ocultos e sem dados", () => {
  const c = cashCard(pv(cash), "BRL", true)!;
  assert.equal(c.perDay, "••••");
  assert.ok(c.accounts.every((a) => a.value === "••••"));
  assert.equal(cashCard(pv(null), "BRL", false), null);
  assert.equal(cashCard(pv({ ...cash, payDate: null }), "BRL", false)!.caption, "Sem data de pagamento prevista");
});
