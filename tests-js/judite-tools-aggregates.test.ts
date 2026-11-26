import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { runTool } from "../src/server/judite-tools.ts";

async function simpleFamily(seed = true) {
  const db = await openDatabase();
  const email = "aggregates@example.invalid";
  const userId = await createFamily(db, { name: "Pessoa fictícia", familyName: "Teste", email, password: "SenhaFicticia!2026" });
  const familyId = (await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])).rows[0]
    .household_id;
  const user: Identity = { userId, familyId, name: "Pessoa", email, role: "owner" };
  const account = randomUUID();
  const food = randomUUID();
  const pay = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Teste','BRL','checking',$3)",
    [account, familyId, userId],
  );
  await db.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Mercado'),($3,$2,'Salário')", [food, familyId, pay]);
  const add = (date: string, amount: string, kind: string, category: string | null) =>
    asUser(db, userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account,
        date,
        description: "Compra",
        amount,
        kind,
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
  const now = settledToday().slice(0, 7);
  const m1 = shiftMonth(now, -1);
  const m2 = shiftMonth(now, -2);
  if (seed) {
    await add(`${m2}-05`, "-30,00", "expense", food);
    await add(`${m2}-06`, "-20,00", "expense", food);
    await add(`${m1}-10`, "-45,00", "expense", food);
    await add(`${m1}-11`, "1000,00", "income", pay);
  }
  const catalog = {
    categories: [{ id: food, name: "Mercado" }],
    accounts: [{ id: account, name: "Corrente", kind: "checking", currency: "BRL" as const }],
    goals: [],
  };
  return { ctx: { db, user, catalog, currency: "BRL" as const, cache: {} }, m1, m2 };
}

type Search = {
  totais: { entrada_cents: string; saida_cents: string };
  por_mes?: { mes: string; entrada_cents: string; saida_cents: string; linhas: number }[];
  filtros: Record<string, string>;
  populacao: string;
  competencia: string;
};
type History = {
  periodo: { de: string; ate: string; meses: number } | null;
  total_cents: string;
  meses: { mes: string; cents: string }[];
  populacao: string;
  competencia: string;
};

test("buscar_movimentos: por_mes soma igual a totais e filtros legíveis", async () => {
  const { ctx, m1, m2 } = await simpleFamily();
  const out = (await runTool(ctx, { name: "buscar_movimentos", de: `${m2}-01`, ate: `${m1}-28`, categoria: "c0" })) as Search;
  assert.deepEqual(out.filtros, { categoria: "Mercado" });
  assert.equal(out.populacao, "movimentos");
  assert.ok(out.competencia.length > 0);
  const months = out.por_mes!;
  assert.deepEqual(months.map((m) => m.mes), [m2, m1]);
  const sum = (k: "entrada_cents" | "saida_cents") => months.reduce((s, m) => s + BigInt(m[k]), 0n).toString();
  assert.equal(sum("entrada_cents"), out.totais.entrada_cents);
  assert.equal(sum("saida_cents"), out.totais.saida_cents);
  const one = (await runTool(ctx, { name: "buscar_movimentos", de: `${m1}-01`, ate: `${m1}-28` })) as Search;
  assert.equal(one.por_mes, undefined);
  assert.deepEqual(one.filtros, {});
});

test("historico_categoria: total_cents soma a série e bate com buscar_movimentos por mês", async () => {
  const { ctx, m1, m2 } = await simpleFamily();
  const h = (await runTool(ctx, { name: "historico_categoria", categoria: "c0" })) as History;
  assert.equal(h.populacao, "dia_a_dia");
  assert.ok(h.competencia.length > 0);
  assert.deepEqual(h.periodo, { de: m2, ate: m1, meses: 2 });
  assert.equal(h.total_cents, h.meses.reduce((s, m) => s + BigInt(m.cents), 0n).toString());
  for (const m of h.meses) {
    const s = (await runTool(ctx, { name: "buscar_movimentos", de: `${m.mes}-01`, ate: `${m.mes}-28`, categoria: "c0" })) as Search;
    assert.equal(s.totais.saida_cents, m.cents, `mês ${m.mes}`);
  }
});

test("historico_categoria sem meses fechados: periodo null e total 0", async () => {
  const { ctx } = await simpleFamily(false);
  const h = (await runTool(ctx, { name: "historico_categoria", categoria: "c0" })) as History;
  assert.equal(h.periodo, null);
  assert.equal(h.total_cents, "0");
});
