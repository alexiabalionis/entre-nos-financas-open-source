import { test } from "node:test";
import assert from "node:assert/strict";
import { asUser, openDatabase } from "../src/server/db.ts";
import { classifyIncome, INCOME_GROUPS } from "../src/domain/income-types.ts";
import { readCategoryEveryday } from "../src/server/context-notes.ts";
import { readIncomeEntries, readMonthFlows } from "../src/server/insights.ts";
import { askHelp } from "../src/server/help.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { OPEN_QUESTION, catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { day, openLedger, ym } from "../scripts/judite-eval-scenarios.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { addDays } from "../src/domain/day.ts";

const BACKS = [6, 5, 4, 3, 2, 1];

/** Salário 6.000 todo mês, saída 7.000, freelas de 2.500 em 4 meses (origens diferentes), um resgate e um Pix do próprio membro. */
async function buildG1(db: Awaited<ReturnType<typeof openDatabase>>) {
  const l = await openLedger(db, 0, "income");
  const mercado = await l.category("Mercado");
  for (const back of BACKS) {
    await l.add("income", day(back, 5), 6000, null, "Salario Empresa Ficticia");
    await l.add("expense", day(back, 9), 7000, mercado, "SUPERMERCADO BOM PRECO");
  }
  for (const [i, back] of [6, 5, 4, 3].entries())
    await l.add("income", day(back, 15), 2500, null, `PIX RECEBIDO Cliente ${["Alfa", "Beta", "Gama", "Delta"][i]} Ltda`);
  await l.add("income", day(2, 12), 3000, null, "RESGATE RDB");
  await l.add("income", day(1, 12), 1500, null, "PIX RECEBIDO Pessoa Fictícia");
  const ctx: ToolContext = { db, user: l.user, catalog: await catalogFor(db, l.user), currency: "BRL", cache: {} };
  return { l, ctx };
}

type Result = {
  meses_fechados: number;
  por_grupo: { grupo: string; media_mensal_cents: string; total_cents: string; entradas: number }[];
  saida_media_cents: string;
  sobra_atual_media_cents: string;
  sobra_estrutural_cents: string;
  suspeitas: { origem: string; motivo: string }[];
  avulsas_maiores: { origem: string }[];
};

test("renda_por_tipo: grupos fecham com o Panorama mês a mês; sobra estrutural negativa", async () => {
  const db = await openDatabase();
  const { l, ctx } = await buildG1(db);
  const out = (await runTool(ctx, { name: "renda_por_tipo" })) as Result;
  assert.deepEqual(out.por_grupo.map((g) => g.grupo), [...INCOME_GROUPS]);
  const group = (g: string) => out.por_grupo.find((x) => x.grupo === g)!;
  assert.equal(group("recorrente").total_cents, "3600000");
  assert.equal(group("avulsa").entradas, 4);
  assert.equal(group("suspeita_dinheiro_proprio").entradas, 2);
  assert.equal(out.saida_media_cents, "700000");
  assert.equal(out.sobra_estrutural_cents, "-100000");
  assert.ok(BigInt(out.sobra_estrutural_cents) < 0n);

  // Mesma média de sobra_atual (mesma função, mesmo filtro de meses fechados).
  const sobra = (await runTool(ctx, { name: "sobra_atual" })) as { saida_media_cents: string; sobra_media_cents: string };
  assert.equal(out.saida_media_cents, sobra.saida_media_cents);
  assert.equal(out.sobra_atual_media_cents, sobra.sobra_media_cents);

  // Conciliação: para cada mês, soma dos 4 grupos = MonthFlow.in do Panorama.
  const e = await readCategoryEveryday(db, l.user);
  const scope = { familyId: l.user.familyId, from: `${shiftMonth(e.currentMonth, -11)}-01`, to: addDays(settledToday(), 1) };
  const { entries, flows } = await asUser(db, l.user.userId, async (tx) => ({
    entries: await readIncomeEntries(tx, scope),
    flows: await readMonthFlows(tx, scope, []),
  }));
  const rows = classifyIncome({
    entries: entries.map((x) => ({ id: x.id, month: x.date.slice(0, 7), cents: x.cents, kind: x.kind, description: x.description })),
    accountNames: ["Corrente"],
    memberNames: ["Pessoa fictícia"],
    linkedIds: new Set(),
  });
  for (const f of flows) {
    const sum = rows.filter((r) => r.month === f.month).reduce((s, r) => s + r.cents, 0n);
    assert.equal(sum, f.in, f.month);
  }
  assert.ok(BACKS.every((b) => flows.some((f) => f.month === ym(b) && f.in > 0n)));
});

test("renda_por_tipo: nenhum nome de pessoa nem descrição no resultado; investimento mostra o rótulo", async () => {
  const db = await openDatabase();
  const { ctx } = await buildG1(db);
  const out = (await runTool(ctx, { name: "renda_por_tipo" })) as Result;
  const json = JSON.stringify(out);
  for (const leak of [/pessoa fict/i, /cliente/i, /alfa|beta|gama|delta/i, /pix recebido/i, /empresa/i]) assert.doesNotMatch(json, leak);
  assert.ok(out.suspeitas.some((s) => s.motivo === "investimento" && s.origem === "Resgate RDB"));
  assert.ok(out.suspeitas.some((s) => s.motivo === "nome_da_casa" && /^o\d+$/.test(s.origem)));
  assert.ok(out.avulsas_maiores.every((a) => /^o\d+$/.test(a.origem)));
});

test("diagnóstico: prefetch traz renda_por_tipo e o modelo ainda recebe ferramentas_restantes 5", async () => {
  const db = await openDatabase();
  const { l } = await buildG1(db);
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED", "JUDITE_DIAG_PREFETCH"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AI_PROVIDER: "groq", GROQ_API_KEY: "synthetic-key", GROQ_ZDR_CONFIRMED: "true" });
  delete process.env.JUDITE_DIAG_PREFETCH;
  const seen: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
    seen.push(JSON.parse(body.messages.find((m) => m.role === "user")!.content));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text: "Síntese: sem novidades.", action: null }) } }] });
  }) as typeof fetch;
  try {
    await askHelp(db, l.user, { question: OPEN_QUESTION, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    const names = (seen[0]!.tool_results as { chamada: { name: string } }[]).map((r) => r.chamada.name);
    assert.deepEqual(names, ["padroes", "renda_por_tipo", "avisos_de_dados", "proximas_decisoes"]);
    assert.equal(seen[0]!.ferramentas_restantes, 5);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
