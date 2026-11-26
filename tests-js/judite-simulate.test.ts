import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { listGoals, savePlanRange } from "../src/server/reserves.ts";
import { simulateScenario } from "../src/server/future-simulate.ts";
import { askHelp } from "../src/server/help.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";

const TABLES = ["chat_actions", "goals", "reserve_plans", "reserve_movements"];

test("simulation never writes and reports the effect on the goal", async () => {
  const db = await openDatabase();
  const fetchOriginal = globalThis.fetch;
  const env = Object.fromEntries(
    ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  try {
    const email = "simulate@example.invalid";
    const userId = await createFamily(db, {
      name: "Pessoa fictícia",
      familyName: "Teste",
      email,
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
      email,
      role: "owner",
    };
    const start = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    })
      .format(new Date())
      .slice(0, 7);
    await createGoal(db, user, {
      name: "Viagem",
      target: "1.200,00",
      deadline_month: shiftMonth(start, 12),
    });
    const goals = (await listGoals(db, user)).filter(
      (g) => g.name === "Viagem",
    );
    assert.equal(goals.length, 1);
    await savePlanRange(db, user, {
      goal_id: goals[0].id,
      from_month: start,
      months: 12,
      planned: "100,00",
    });
    const catalogGoals = (await listGoals(db, user))
      .filter((g) => g.status === "active")
      .map((g) => ({
        id: g.id,
        name: g.name,
        location: g.location,
        status: g.status,
        target_cents: g.target_cents,
        saved_cents: g.saved_cents,
      }));
    const viagem = catalogGoals.findIndex((g) => g.name === "Viagem");
    assert.ok(viagem >= 0);
    const counts = async () =>
      Promise.all(
        TABLES.map(
          async (t) =>
            (
              await db.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM ${t}`,
              )
            ).rows[0].n,
        ),
      );
    const before = await counts();
    const raw = {
      pauses: [{ goal: "g" + viagem, from_month: start, months: 6 }],
    };
    const text = await simulateScenario(db, user, catalogGoals, raw as never);
    assert.match(text, /nada foi salvo/);
    assert.match(text, /Viagem completa/);
    assert.deepEqual(await counts(), before);

    // Via askHelp: LLM devolve action sem `type`; nada vira chat_actions.
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "synthetic-key";
    process.env.GROQ_ZDR_CONFIRMED = "true";
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ text: "x", action: raw }),
            },
          },
        ],
      });
    const answer = await askHelp(db, user, {
      question: "E se eu pausar a meta da viagem por 6 meses?",
      month: start,
      currency: "BRL",
      external: true,
      chat: true,
      history: [],
    });
    assert.equal((answer as { action?: unknown }).action, undefined);
    assert.match(answer.text, /nada foi salvo/);
    assert.deepEqual(await counts(), before);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
