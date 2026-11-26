import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, type Database } from "../src/server/db.ts";
import type { Identity } from "../src/server/auth.ts";
import { orQuery } from "../src/domain/memory-search.ts";
import { budgetFreePrefetch, initialPrefetch, recallIntent } from "../src/server/judite-evidence.ts";
import { finalizationContext } from "../src/server/judite-finalize.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { readState } from "../src/server/state.ts";
import { askHelp } from "../src/server/help.ts";
import { satisfies } from "../scripts/judite-eval-score.ts";
import { SCENARIOS, ym } from "../scripts/judite-eval-scenarios.ts";

// Regressões da etapa 7: recordar, intenção e perguntas de mais de uma fonte.
let db: Database;
let user: Identity;

before(async () => {
  db = await openDatabase();
  user = await SCENARIOS.find((s) => s.id === "B")!.build(db, 0);
});

const memory = async (consulta: string) => {
  const state = await readState(db, user, `${ym(0)}-01`, "BRL", undefined, undefined, false);
  const ctx: ToolContext = { db, user, catalog: { accounts: state.accounts, categories: state.categories, goals: [] }, currency: "BRL", cache: {} };
  return (await runTool(ctx, { name: "search_memory", consulta, limite: 5 })) as { busca: string; memorias: { texto: string }[] };
};

test("intenção de recordar: 'o que dizíamos antes' busca memória; 'dá para guardar' não", () => {
  for (const q of ["O que dizíamos antes sobre Pet?", "O que a gente dizia antes sobre o gasto com Pet?", "O que a gente combinou e decidiu até agora?"])
    assert.ok(recallIntent(q), q);
  for (const q of ["Dá para guardar R$ 500 por mês para a viagem?", "Quanto sobra por mês?", "O que ainda falta pagar este mês?"])
    assert.ok(!recallIntent(q), q);
  assert.deepEqual(initialPrefetch({ question: "Dá para guardar R$ 500?", activeMemories: 5 }), []);
});

test("busca: verbo de recordar não casa com todo combinado; o assunto decide", async () => {
  assert.equal(orQuery("o que combinamos sobre delivery"), "delivery");
  const delivery = await memory("o que combinamos sobre delivery");
  assert.match(delivery.memorias[0].texto, /Delivery/);
  assert.ok(!delivery.memorias.some((m) => /Lazer/.test(m.texto)), "antes, 'combin' trazia o Lazer junto");
  const pet = await memory("O que a gente dizia antes sobre o gasto com Pet?");
  assert.match(pet.memorias[0].texto, /R\$ 250,00/);
});

test("busca: pedido geral ('o que combinamos e decidimos?') traz as recentes; ruído continua sem nada", async () => {
  const all = await memory("O que a gente combinou e decidiu até agora?");
  assert.equal(all.busca, "recent");
  assert.ok(all.memorias.length > 0);
  assert.equal((await memory("a | b & !c :* (")).busca, "none");
});

test("mais de uma fonte: obrigações completas vêm de falta_pagar ou de fixas + cartões juntos", () => {
  const ok = (name: string) => ({ chamada: { name }, resultado: {} });
  const need = { kind: "obrigacoes" as const, covers: ["fixas", "cartoes"] };
  assert.ok(satisfies(need, [ok("falta_pagar")], ""));
  assert.ok(satisfies(need, [ok("contas_fixas"), ok("cartoes")], ""));
  assert.ok(!satisfies(need, [ok("contas_fixas")], ""), "sem as faturas fica incompleto");
  assert.ok(!satisfies(need, [ok("mes_atual")], ""), "atrasadas não são a lista do mês");
  assert.ok(!satisfies({ kind: "reservas" }, [ok("search_memory")], ""), "combinado de conversa não é reserva");
});

const OPEN = "O que eu poderia fazer diferente nas finanças?";

test("perfil: diagnóstico com memória ativa busca aprendizados fora do orçamento; sem memória, não", () => {
  const withMem = initialPrefetch({ question: OPEN, activeMemories: 1 });
  assert.deepEqual(withMem.map((c) => c.name), ["padroes", "renda_por_tipo", "avisos_de_dados", "search_memory", "proximas_decisoes"]);
  const profile = withMem.find((c) => c.name === "search_memory")!;
  assert.deepEqual(profile, { name: "search_memory", tipo: "aprendizado", limite: 8 });
  assert.equal(budgetFreePrefetch(profile), true);
  assert.deepEqual(initialPrefetch({ question: OPEN, activeMemories: 0 }).map((c) => c.name), ["padroes", "renda_por_tipo", "avisos_de_dados", "proximas_decisoes"]);
  const saved = process.env.JUDITE_DIAG_PREFETCH;
  process.env.JUDITE_DIAG_PREFETCH = "basic";
  try {
    assert.deepEqual(initialPrefetch({ question: OPEN, activeMemories: 1 }).map((c) => c.name), ["padroes"]);
  } finally {
    if (saved === undefined) delete process.env.JUDITE_DIAG_PREFETCH;
    else process.env.JUDITE_DIAG_PREFETCH = saved;
  }
});

test("perfil: a busca de recall continua gastando orçamento e não é duplicada no diagnóstico", () => {
  const recall = "O que a gente combinou sobre delivery?";
  const [only] = initialPrefetch({ question: recall, activeMemories: 3 });
  assert.equal(budgetFreePrefetch(only), false);
  const both = initialPrefetch({ question: `${recall} O que eu poderia fazer diferente?`, activeMemories: 3, diagnostic: true });
  assert.equal(both.filter((c) => c.name === "search_memory").length, 1);
  assert.equal(budgetFreePrefetch(both.find((c) => c.name === "search_memory")!), false);
});

test("perfil: restricoes_da_casa só traz aprendizados (até 5, texto até 200)", () => {
  const base = { refs: { patterns: new Set<string>(), simulations: new Map<string, string>() }, roles: new Map() };
  const hit = (ref: string, tipo: string, texto: string) => ({ ref, tipo, categoria: null, temas: [], texto });
  const memorias = [
    hit("m0", "aprendizado", "x".repeat(300)),
    hit("m1", "combinado", "Delivery até R$ 300"),
    ...["m2", "m3", "m4", "m5", "m6", "m7"].map((r) => hit(r, "aprendizado", `texto ${r}`)),
  ];
  const ctx = finalizationContext({ ...base, results: [{ chamada: { name: "search_memory" }, resultado: { memorias } }] }) as { restricoes_da_casa?: { ref: string; texto: string }[] };
  assert.deepEqual(ctx.restricoes_da_casa?.map((r) => r.ref), ["m0", "m2", "m3", "m4", "m5"]);
  assert.equal(ctx.restricoes_da_casa?.[0].texto.length, 200);
  const none = finalizationContext({ ...base, results: [{ chamada: { name: "search_memory" }, resultado: { memorias: [memorias[1]] } }] });
  assert.equal("restricoes_da_casa" in none, false);
});

test("perfil no loop: prefetch de aprendizado não gasta orçamento; recall sozinho gasta 1", async () => {
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
  const ask = (question: string) => askHelp(db, user, { question, month: ym(0), currency: "BRL", external: true, chat: true, history: [] });
  try {
    await ask(OPEN);
    const names = (seen[0]!.tool_results as { chamada: { name: string } }[]).map((r) => r.chamada.name);
    assert.deepEqual(names.slice(-2), ["search_memory", "proximas_decisoes"]);
    assert.equal(seen[0]!.ferramentas_restantes, 5);
    const before = seen.length;
    await ask("O que a gente combinou sobre delivery?");
    const recall = (seen[before]!.tool_results as { chamada: { name: string } }[]).map((r) => r.chamada.name);
    assert.deepEqual(recall, ["search_memory"]);
    assert.equal(seen[before]!.ferramentas_restantes, 5, "o recall gasta 1 do orçamento de 6 da rota fechada");
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("abertura: rota aberta pré-carrega fora do orçamento; fora dela, não; basic tira", () => {
  assert.deepEqual(initialPrefetch({ question: "E no mercado?", activeMemories: 0, open: true }), [{ name: "abertura" }, { name: "proximas_decisoes" }]);
  assert.deepEqual(initialPrefetch({ question: "E no mercado?", activeMemories: 0 }), []);
  assert.equal(budgetFreePrefetch({ name: "abertura" }), true);
  const saved = process.env.JUDITE_DIAG_PREFETCH;
  process.env.JUDITE_DIAG_PREFETCH = "basic";
  try {
    assert.deepEqual(initialPrefetch({ question: "E no mercado?", activeMemories: 0, open: true }), []);
  } finally {
    if (saved === undefined) delete process.env.JUDITE_DIAG_PREFETCH;
    else process.env.JUDITE_DIAG_PREFETCH = saved;
  }
});
