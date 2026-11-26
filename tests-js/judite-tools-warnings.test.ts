import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/server/db.ts";
import { askHelp } from "../src/server/help.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { budgetFreePrefetch, initialPrefetch } from "../src/server/judite-evidence.ts";
import { finalizationContext } from "../src/server/judite-finalize.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { OPEN_QUESTION, catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { day, openLedger } from "../scripts/judite-eval-scenarios.ts";

const BACKS = [6, 5, 4, 3, 2, 1];
const NAMES = ["Alfa Souza", "Beta Lima", "Gama Rocha"];

type Out = {
  saida_total_cents: string;
  sem_categoria: { compras: number; total_cents: string; parte_da_saida: number; grupos: { destinatario: string | null; compras: number; total_cents: string }[] };
  fora_da_curva: { categoria: string; mes: string; mes_sem_ela_cents: string }[];
  em_revisao: { linhas: number; saidas_cents: string; entradas_cents: string };
  entradas_suspeitas: { entradas: number };
};

/** 30 Pix sem categoria para 3 destinatários, Outras com 200 por mês e uma câmera de 8.700. */
async function build(db: Awaited<ReturnType<typeof openDatabase>>, { camera = true } = {}) {
  const l = await openLedger(db, 0, "warnings");
  const mercado = await l.category("Mercado");
  const outras = await l.category("Outras");
  for (const back of BACKS) {
    await l.add("expense", day(back, 9), 500, mercado, "SUPERMERCADO BOM PRECO");
    await l.add("expense", day(back, 8), 200, outras, "PAPELARIA CENTRAL");
  }
  if (camera) await l.add("expense", day(3, 20), 8700, outras, "CAMERA FOTOGRAFICA");
  for (let i = 0; i < 30; i++)
    await l.add("expense", day(BACKS[i % 6]!, 10 + Math.floor(i / 6)), ((i % 3) + 1) * 100, null, `PIX ENVIADO ${NAMES[i % 3]!.toUpperCase()} 123.456.789-00`);
  const ctx: ToolContext = { db, user: l.user, catalog: await catalogFor(db, l.user), currency: "BRL", cache: {} };
  return { l, ctx };
}

test("avisos_de_dados: 30 Pix sem categoria viram 3 grupos d0..d2, sem nome", async () => {
  const { ctx } = await build(await openDatabase());
  const out = (await runTool(ctx, { name: "avisos_de_dados" })) as Out;
  assert.equal(out.sem_categoria.compras, 30);
  assert.equal(out.sem_categoria.total_cents, "600000");
  assert.equal(out.saida_total_cents, "1890000");
  assert.equal(out.sem_categoria.parte_da_saida, 31.7);
  assert.deepEqual(out.sem_categoria.grupos.map((g) => g.destinatario).sort(), ["d0", "d1", "d2"]);
  assert.deepEqual(out.sem_categoria.grupos.map((g) => [g.compras, g.total_cents]), [[10, "300000"], [10, "200000"], [10, "100000"]]);
  const json = JSON.stringify(out);
  for (const leak of [/alfa|beta|gama/i, /souza|lima|rocha/i, /123\.456/, /pix enviado [a-z]/i, /papelaria|supermercado/i]) assert.doesNotMatch(json, leak);
});

test("avisos_de_dados: câmera em Outras vira fora_da_curva e o mês sem ela fica em 200", async () => {
  const { ctx } = await build(await openDatabase());
  const out = (await runTool(ctx, { name: "avisos_de_dados" })) as Out;
  assert.equal(out.fora_da_curva.length, 1);
  assert.equal(out.fora_da_curva[0]!.categoria, "Outras");
  assert.equal(out.fora_da_curva[0]!.mes_sem_ela_cents, "20000");
});

test("avisos_de_dados: sem a compra grande não há fora_da_curva", async () => {
  const { ctx } = await build(await openDatabase(), { camera: false });
  assert.deepEqual(((await runTool(ctx, { name: "avisos_de_dados" })) as Out).fora_da_curva, []);
});

test("avisos_de_dados: linhas do banco sem grupo claro contam como em revisão; as classificadas não", async () => {
  const { l, ctx } = await build(await openDatabase(), { camera: false });
  const { db } = ctx;
  const local = (await db.query<{ id: string }>("SELECT id FROM accounts WHERE household_id=$1 AND name='Corrente'", [l.user.familyId])).rows[0]!.id;
  const connection = randomUUID();
  const bankAccount = randomUUID();
  await db.query("INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')", [l.user.familyId, l.user.userId]);
  await db.query("INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2020-01-01')", [connection, l.user.familyId, l.user.userId, randomUUID()]);
  await db.query("INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Banco','BRL','BANK',$5)", [bankAccount, l.user.familyId, connection, randomUUID(), local]);
  for (const [amount, group] of [[-50000, "unclear"], [30000, "pending"], [-70000, "transfer"]] as const)
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,status,analysis)
       VALUES($1,$2,$3,$4,$5,$6,'LINHA TESTE',$7,'BRL','POSTED','synthetic',$8,'pending',$9::jsonb)`,
      [randomUUID(), l.user.familyId, bankAccount, local, randomUUID(), day(2, 5), amount, randomUUID(), JSON.stringify({ group })],
    );
  const out = (await runTool(ctx, { name: "avisos_de_dados" })) as Out;
  assert.equal(out.em_revisao.linhas, 2);
  assert.equal(out.em_revisao.saidas_cents, "50000");
  assert.equal(out.em_revisao.entradas_cents, "30000");
  assert.equal(out.entradas_suspeitas.entradas, 0);
});

test("finalizationContext: avisos_a_citar só quando há aviso, com os 2 maiores", async () => {
  const { ctx } = await build(await openDatabase());
  const warnings = await runTool(ctx, { name: "avisos_de_dados" });
  const base = { refs: { patterns: new Set<string>(), simulations: new Map<string, string>() }, roles: new Map() };
  const withWarn = finalizationContext({ ...base, results: [{ chamada: { name: "avisos_de_dados" }, resultado: warnings }] }) as { avisos_a_citar?: { tipo: string }[] };
  assert.deepEqual(withWarn.avisos_a_citar?.map((a) => a.tipo), ["fora_da_curva", "sem_categoria"]);
  const clean = { sem_categoria: { compras: 0 }, fora_da_curva: [], em_revisao: { linhas: 0 }, entradas_suspeitas: { entradas: 0 } };
  const none = finalizationContext({ ...base, results: [{ chamada: { name: "avisos_de_dados" }, resultado: clean }] });
  assert.equal("avisos_a_citar" in none, false);
});

test("diagnóstico: prefetch traz renda e avisos fora do orçamento; basic desliga os dois", async () => {
  assert.deepEqual(initialPrefetch({ question: OPEN_QUESTION, activeMemories: 0 }).map((c) => c.name), ["padroes", "renda_por_tipo", "avisos_de_dados", "proximas_decisoes"]);
  assert.equal(budgetFreePrefetch({ name: "avisos_de_dados" }), true);
  const saved = process.env.JUDITE_DIAG_PREFETCH;
  process.env.JUDITE_DIAG_PREFETCH = "basic";
  try {
    assert.deepEqual(initialPrefetch({ question: OPEN_QUESTION, activeMemories: 0 }).map((c) => c.name), ["padroes"]);
  } finally {
    if (saved === undefined) delete process.env.JUDITE_DIAG_PREFETCH;
    else process.env.JUDITE_DIAG_PREFETCH = saved;
  }
});

test("diagnóstico: o modelo recebe os dois resultados e ferramentas_restantes 5", async () => {
  const db = await openDatabase();
  const { l } = await build(db);
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
