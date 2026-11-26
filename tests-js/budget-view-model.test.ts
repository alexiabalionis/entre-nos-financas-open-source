import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barSegments,
  budgetCard,
  budgetState,
  sortedCards,
  uncappedCategories,
  verdictText,
  type BudgetRow,
} from "../app/budgets/budget-view-model.ts";

const fmt = (c: bigint) => `R$${c / 100n},${String(c % 100n).padStart(2, "0")}`;

function row(over: Partial<BudgetRow> & { ceiling: number; spent: number; open?: number }): BudgetRow {
  const { ceiling, spent, open = 0, ...rest } = over;
  const committed = spent + open;
  return {
    category_id: "c1",
    category_name: "Mercado",
    planned_cents: String(ceiling),
    spent_cents: String(spent),
    remaining_cents: String(ceiling - spent),
    ceiling_from: "2026-09-01",
    open_planned_cents: String(open),
    committed_cents: String(committed),
    over: committed > ceiling,
    ...rest,
  };
}

test("estados: dentro, perto (até 10% do teto), vai passar e passou", () => {
  assert.equal(budgetState(row({ ceiling: 10000, spent: 8999 })), "dentro");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 9000 })), "perto");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 9500 })), "perto");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 10000 })), "perto");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 6000, open: 4001 })), "vaipassar");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 10001 })), "passou");
  assert.equal(budgetState(row({ ceiling: 10000, spent: 12000, open: 500 })), "passou");
});

test("sobra e excesso usam gasto mais previsto", () => {
  const c = budgetCard(row({ ceiling: 60000, spent: 38000, open: 35000 }));
  assert.equal(c.excess, 13000n);
  assert.equal(c.free, 0n);
  assert.equal(verdictText(c, fmt), "Vai passar R$130,00 se pagar o que está previsto");
  const d = budgetCard(row({ ceiling: 10000, spent: 9500 }));
  assert.equal(verdictText(d, fmt), "Sobra só R$5,00 no teto");
});

test("ordem: passou, vai passar, perto, dentro; empate por nome", () => {
  const rows = [
    row({ category_id: "a", category_name: "Zeta", ceiling: 10000, spent: 1000 }),
    row({ category_id: "b", category_name: "Beta", ceiling: 10000, spent: 9500 }),
    row({ category_id: "c", category_name: "Gama", ceiling: 10000, spent: 5000, open: 6000 }),
    row({ category_id: "d", category_name: "Delta", ceiling: 10000, spent: 11000 }),
    row({ category_id: "e", category_name: "Alfa", ceiling: 10000, spent: 1000 }),
  ];
  assert.deepEqual(sortedCards(rows).map((c) => c.name), ["Delta", "Gama", "Beta", "Alfa", "Zeta"]);
});

test("categoria sem teto fica fora da lista", () => {
  const rows = [row({ category_id: "a", ceiling: 100, spent: 0 })];
  const free = uncappedCategories([{ id: "a" }, { id: "b" }], rows);
  assert.deepEqual(free, [{ id: "b" }]);
});

test("barra: o excesso fica à parte e a soma fecha com o teto quando não passa", () => {
  const ok = barSegments(budgetCard(row({ ceiling: 10000, spent: 2000, open: 3000 })));
  assert.equal(ok.reduce((s, p) => s + p.value, 0), 10000);
  const over = barSegments(budgetCard(row({ ceiling: 10000, spent: 12000 })));
  assert.deepEqual(over.map((p) => p.value), [10000, 2000]);
  assert.equal(over[1].color, "var(--family-danger)");
  const soon = barSegments(budgetCard(row({ ceiling: 10000, spent: 6000, open: 6000 })));
  assert.equal(soon[2].color, "var(--family-warn)");
});
