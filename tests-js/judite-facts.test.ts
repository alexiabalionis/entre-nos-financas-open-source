import { test } from "node:test";
import assert from "node:assert/strict";
import { retrieveFacts, classifyQuestion } from "../src/domain/retrieval.ts";
import { insightsContext } from "../src/domain/insights-facts.ts";
import type { HelpContext } from "../src/domain/help.ts";
import type { Insights } from "../src/server/insights.ts";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { askHelp } from "../src/server/help.ts";

const base: HelpContext = {
  month: "2026-10",
  currency: "BRL",
  today: "2026-10-22",
  items: [],
  income_cents: "123456",
  expense_cents: "5555",
  unresolved: 0,
  budgets: [],
};

const insights: Insights = {
  today: "2026-10-22",
  current: true,
  future: false,
  months: [{ month: "2026-09", in: 1000n, out: 500n }],
  summary: {
    months: 1,
    avgIn: 1000n,
    avgOut: 500n,
    keptAvg: 500n,
    keptPct: 50,
    best: { month: "2026-09", kept: 500n },
    negative: [],
  },
  balance: [{ day: "2026-10-01", cents: 99999n }],
  categories: {
    month: Array.from({ length: 8 }, (_, i) => ({
      name: `Cat${i}`,
      cents: BigInt(100 - i),
      prev: null,
    })),
    lastMonth: Array.from({ length: 7 }, (_, i) => ({
      name: `Ant${i}`,
      cents: BigInt(50 - i),
      prev: null,
    })),
    quarter: [],
  },
  categoryMonths: [{ month: "2026-09", name: "Cat0", cents: 12345n }],
  fixed: { fixed: 0n, everyday: 0n },
  days: [0n, null],
  places: {
    quarter: [],
    year: Array.from({ length: 9 }, (_, i) => ({
      merchant: `SEGREDO_BRUTO_${i}`,
      label: `Lugar ${i}`,
      category: null,
      visits: 2,
      total: BigInt(900 - i),
      average: 450n,
      last: "2026-10-01",
    })),
  },
};

const goalList = [
  {
    name: "Viagem",
    target_cents: "100000",
    saved_cents: "30000",
    verified_cents: "10000",
    declared_cents: "20000",
    deadline_month: "2027-06-01",
    status: "active",
    has_location: true,
  },
];

test("insightsContext truncates to top 5, hides merchant and raw series", () => {
  const ctx = insightsContext(insights);
  assert.equal(ctx.categories_month.length, 5);
  assert.equal(ctx.categories_last_month.length, 5);
  assert.equal(ctx.places_year.length, 5);
  const json = JSON.stringify(ctx);
  assert.doesNotMatch(json, /merchant|SEGREDO_BRUTO|99999|12345/);
  assert.equal(ctx.summary?.avg_income_cents, "1000");
});

test("E1/D1/L1/M1 only appear when relevant and carry no raw ids or merchants", () => {
  const ctx: HelpContext = {
    ...base,
    insights: insightsContext(insights),
    goalList,
  };
  const ids = (q: string) => retrieveFacts(q, ctx).facts.map((f) => f.id);
  assert.deepEqual(
    ids("Qual a tendência das minhas categorias?").filter((i) =>
      /^[EDLM]1$/.test(i),
    ),
    ["E1", "D1", "L1"],
  );
  assert.deepEqual(
    ids("Como está o prazo do objetivo?").filter((i) => /^[EDLM]1$/.test(i)),
    ["M1"],
  );
  assert.deepEqual(
    ids("Explique o planejamento").filter((i) => /^[EDLM]1$/.test(i)),
    [],
  );
  const retrieval = retrieveFacts("tendência e meta com prazo", ctx);
  assert.doesNotMatch(JSON.stringify(retrieval), /merchant|SEGREDO_BRUTO/);
  const goalsJson = JSON.stringify(
    retrieval.facts.find((f) => f.id === "M1")?.data.goals,
  );
  assert.doesNotMatch(goalsJson, /"id"|"location"/);
  assert.match(goalsJson, /has_location/);
  const m1 = retrieveFacts("meta com prazo", ctx).facts.find(
    (f) => f.id === "M1",
  );
  assert.equal(m1?.data.saved_equals_verified_plus_declared, true);
  assert.equal(m1?.data.not_investment_balance, true);
});

test("plan-only and food-only questions keep exactly the previous fact ids", () => {
  const ctx: HelpContext = {
    ...base,
    insights: insightsContext(insights),
    goalList,
  };
  assert.deepEqual(
    retrieveFacts("Explique o planejamento", ctx).facts.map((f) => f.id),
    ["P1", "H1"],
  );
  assert.deepEqual(
    retrieveFacts("Quanto cabe em alimentação?", ctx).facts.map((f) => f.id),
    ["A1"],
  );
  const cq = classifyQuestion("Quanto cabe em alimentação?");
  assert.equal(cq.insights, false);
  assert.equal(cq.goals, false);
});

test("askHelp external with insights/goals question does not create a goal", async () => {
  const db = await openDatabase();
  const fetchOriginal = globalThis.fetch;
  const env = Object.fromEntries(
    ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  try {
    const userId = await createFamily(db, {
      name: "Pessoa fictícia",
      familyName: "Teste",
      email: "judite-facts@example.invalid",
      password: "SenhaFicticia!2026",
    });
    const familyId = (
      await db.query<{ household_id: string }>(
        "SELECT household_id FROM members WHERE user_id=$1",
        [userId],
      )
    ).rows[0].household_id;
    const user: Identity = {
      userId,
      familyId,
      name: "Pessoa",
      email: "judite-facts@example.invalid",
      role: "owner",
    };
    const goalCount = async () =>
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM goals WHERE household_id=$1",
          [familyId],
        )
      ).rows[0].n;
    const before = await goalCount();
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "synthetic-key";
    process.env.GROQ_ZDR_CONFIRMED = "true";
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Resposta fictícia" },
          },
        ],
      });
    const answer = await askHelp(db, user, {
      question: "Qual a evolução das categorias e das metas com prazo?",
      month: "2026-10",
      currency: "BRL",
      external: true,
    });
    assert.match(answer.text, /Resposta fictícia/);
    assert.match(answer.source, /M1/);
    assert.equal(await goalCount(), before);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
