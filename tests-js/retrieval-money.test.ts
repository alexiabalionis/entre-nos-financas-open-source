import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withFormattedMoney,
  retrieveFacts,
  categoryMentioned,
} from "../src/domain/retrieval.ts";
import { categorySpendContext } from "../src/domain/insights-facts.ts";
import type { HelpContext } from "../src/domain/help.ts";

test("cada campo em centavos ganha um irmão formatado, sem alterar o original", () => {
  const out = withFormattedMoney(
    {
      income_cents: "345932",
      nested: [{ cents: "831470", prev_cents: null, note: "12" }],
      goals: [{ target_cents: "-2045738" }],
      count: 3,
    },
    "BRL",
  );
  assert.deepEqual(out, {
    income_cents: "345932",
    income_formatted: "R$ 3.459,32",
    nested: [
      {
        cents: "831470",
        formatted: "R$ 8.314,70",
        prev_cents: null,
        note: "12",
      },
    ],
    goals: [{ target_cents: "-2045738", target_formatted: "R$ -20.457,38" }],
    count: 3,
  });
});

test("usa a moeda do contexto e ignora valores que não são inteiros", () => {
  assert.deepEqual(
    withFormattedMoney({ amount_cents: "1050", bad_cents: "12,5" }, "USD"),
    { amount_cents: "1050", amount_formatted: "US$ 10,50", bad_cents: "12,5" },
  );
});

test("G1 lista todas as categorias do mês, com valor formatado, só quando a pergunta pede gasto", () => {
  const ctx: HelpContext = {
    month: "2026-11",
    currency: "BRL",
    today: "2026-11-19",
    items: [],
    income_cents: "0",
    expense_cents: "0",
    unresolved: 0,
    budgets: [],
    categorySpend: {
      month: "2026-11",
      categories: [
        {
          name: "Supermercado e feira",
          cents: "28672",
          item_count: 2,
          items: [
            {
              date: "2026-11-18",
              label: "Feira",
              cents: "8672",
              confirmed: false,
            },
            {
              date: "2026-11-02",
              label: "Mercado",
              cents: "20000",
              confirmed: true,
            },
          ],
        },
        { name: "Lazer", cents: "-1000", item_count: 1 },
      ],
      total_cents: "27672",
    },
  };
  const g1 = retrieveFacts("quanto gastei com supermercado?", ctx).facts.find(
    (f) => f.id === "G1",
  );
  assert.ok(g1);
  const data = g1.data as {
    categories: { name: string; cents: string; formatted: string }[];
    total_formatted: string;
  };
  assert.equal(data.categories[0].formatted, "R$ 286,72");
  assert.equal(data.categories[1].formatted, "R$ -10,00");
  assert.equal(data.total_formatted, "R$ 276,72");
  assert.equal(
    retrieveFacts("quanto falta pagar?", ctx).facts.some((f) => f.id === "G1"),
    false,
  );
});

test("com G1, o T1 não repete a mesma categoria no mesmo mês com outra conta", () => {
  const month = (m: string) => ({
    month: m,
    income_cents: "0",
    expense_cents: "0",
    planned_income_cents: "0",
    planned_commitments_cents: "0",
    unknown_planned: 0,
    categories: [{ name: "Supermercado e feira", cents: "28672" }],
  });
  const ctx = {
    month: "2026-11",
    currency: "BRL",
    today: "2026-11-19",
    items: [],
    income_cents: "0",
    expense_cents: "0",
    unresolved: 0,
    budgets: [],
    historyMonths: [month("2026-10"), month("2026-11")],
    categorySpend: {
      month: "2026-11",
      categories: [
        { name: "Supermercado e feira", cents: "226537", item_count: 0 },
      ],
      total_cents: "226537",
    },
  } as unknown as HelpContext;
  const facts = retrieveFacts("quanto gastei com supermercado?", ctx).facts;
  const t1 = facts.find((f) => f.id === "T1")!.data as {
    monthly_totals: { month: string; relevant_categories: unknown[] }[];
  };
  const byMonth = Object.fromEntries(
    t1.monthly_totals.map((m) => [m.month, m.relevant_categories.length]),
  );
  assert.deepEqual(byMonth, { "2026-10": 1, "2026-11": 0 });
  assert.ok(facts.some((f) => f.id === "G1"));
});

test("categorySpendContext: só a categoria citada leva a lista de compras", () => {
  const ctx = categorySpendContext(
    {
      month: "2026-11",
      total_cents: 30000n,
      categories: [
        {
          name: "Supermercado e feira",
          cents: 20000n,
          items: [
            {
              date: "2026-11-02",
              label: "Mercado",
              cents: 20000n,
              confirmed: false,
            },
          ],
        },
        {
          name: "Lazer",
          cents: 10000n,
          items: [
            {
              date: "2026-11-05",
              label: "Cinema",
              cents: 10000n,
              confirmed: true,
            },
          ],
        },
      ],
    },
    (name) => categoryMentioned("o que comprei no supermercado?", name),
  );
  assert.deepEqual(ctx.categories, [
    {
      name: "Supermercado e feira",
      cents: "20000",
      item_count: 1,
      items: [
        {
          date: "2026-11-02",
          label: "Mercado",
          cents: "20000",
          confirmed: false,
        },
      ],
    },
    { name: "Lazer", cents: "10000", item_count: 1 },
  ]);
});
