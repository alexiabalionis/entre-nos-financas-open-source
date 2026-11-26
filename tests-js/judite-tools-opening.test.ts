import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { askHelp } from "../src/server/help.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { setMerchantAlias } from "../src/server/merchant-alias.ts";
import { evidenceOf } from "../src/server/judite-evidence.ts";
import { catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { day, openLedger } from "../scripts/judite-eval-scenarios.ts";

type Opening = {
  periodo: { de: string; ate: string };
  categorias: {
    categoria: string;
    total_periodo_cents: string;
    media_3_fechados_cents: string;
    media_6_fechados_cents: string;
    maiores_compras: { dia: string; rotulo: string; cents: string }[];
    lugares_que_se_repetem: { rotulo: string; vezes: number; total_cents: string }[];
  }[];
};

const PIX = "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44";

/** 6 categorias: 3 de maior total, 2 em alta e uma pequena e estável que não entra. */
async function build(db: Awaited<ReturnType<typeof openDatabase>>) {
  const l = await openLedger(db, 0, "opening");
  const cat = { mercado: await l.category("Mercado"), lazer: await l.category("Lazer"), casa: await l.category("Casa"), saude: await l.category("Saúde"), transp: await l.category("Transporte"), livros: await l.category("Livros") };
  const pix: string[] = [];
  for (const back of [6, 5, 4, 3, 2, 1]) {
    const recent = back <= 3;
    await l.add("expense", day(back, 9), 800, cat.mercado, "SUPERMERCADO BOM PRECO");
    if (back <= 2) await l.add("expense", day(back, 20), 100, cat.mercado, "PADARIA DO ZE");
    if (recent) pix.push(await l.add("expense", day(back, 12), 700, cat.lazer, PIX));
    if (recent) await l.add("expense", day(back, 5), 500, cat.casa, "CONDOMINIO ALFA");
    await l.add("expense", day(back, 14), recent ? 400 : 0.01, cat.saude, "CLINICA SAUDE");
    await l.add("expense", day(back, 16), recent ? 300 : 100, cat.transp, "POSTO COMBUSTIVEL");
    await l.add("expense", day(back, 18), 50, cat.livros, "LIVRARIA CULTURA");
  }
  await l.add("expense", day(0, 1), 800, cat.mercado, "SUPERMERCADO BOM PRECO");
  const catalog = await catalogFor(db, l.user);
  const ctx = (): ToolContext => ({ db, user: l.user, catalog, currency: "BRL", cache: {} });
  return { l, pix, ctx };
}

test("abertura: no máximo 5 categorias sem repetir, 3 compras e até 3 lugares; lugar com 2 compras não entra", async () => {
  const db = await openDatabase();
  const { ctx } = await build(db);
  const out = (await runTool(ctx(), { name: "abertura" })) as Opening;
  const names = out.categorias.map((c) => c.categoria);
  assert.deepEqual(names, ["Mercado", "Lazer", "Casa", "Saúde", "Transporte"]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(out.periodo.ate, settledToday());
  const mercado = out.categorias[0]!;
  assert.equal(mercado.maiores_compras.length, 3);
  assert.ok(mercado.maiores_compras.every((p) => p.cents === "80000"));
  assert.deepEqual(mercado.lugares_que_se_repetem.map((p) => [p.vezes, p.total_cents]), [[4, "320000"]]);
  assert.doesNotMatch(JSON.stringify(mercado.lugares_que_se_repetem), /padaria/i);
  assert.equal(mercado.total_periodo_cents, "340000");
  assert.equal(mercado.media_3_fechados_cents, String(Math.round(260000 / 3)));
  assert.equal(mercado.media_6_fechados_cents, String(Math.round(500000 / 6)));
  for (const c of out.categorias) assert.ok(c.lugares_que_se_repetem.length <= 3 && c.maiores_compras.length <= 3);
});

test("abertura: Pix sem apelido vira 'Pix enviado (dN)'; com apelido, o apelido; nenhum nome sai", async () => {
  const db = await openDatabase();
  const { ctx, l, pix } = await build(db);
  const plain = (await runTool(ctx(), { name: "abertura" })) as Opening;
  const lazer = plain.categorias.find((c) => c.categoria === "Lazer")!;
  assert.deepEqual(lazer.maiores_compras.map((p) => p.rotulo), ["Pix enviado (d0)", "Pix enviado (d0)", "Pix enviado (d0)"]);
  const wire = (list: { rotulo: string; vezes: number; total_cents: string }[]) => list.map(({ rotulo, vezes, total_cents }) => ({ rotulo, vezes, total_cents }));
  assert.deepEqual(wire(lazer.lugares_que_se_repetem), [{ rotulo: "Pix enviado (d0)", vezes: 3, total_cents: "210000" }]);
  assert.doesNotMatch(JSON.stringify(plain), /fernanda|souza|111/i);

  await setMerchantAlias(db, l.user, { movement_id: `event:${pix[0]}`, alias: "Faxina" });
  const named = (await runTool(ctx(), { name: "abertura" })) as Opening;
  const faxina = named.categorias.find((c) => c.categoria === "Lazer")!;
  assert.deepEqual(wire(faxina.lugares_que_se_repetem), [{ rotulo: "Faxina", vezes: 3, total_cents: "210000" }]);
  assert.ok(faxina.maiores_compras.every((p) => p.rotulo === "Faxina"));
  assert.doesNotMatch(JSON.stringify(named), /fernanda|souza|111/i);
});

test("abertura: evidenceOf traz um gasto_categoria por categoria, população movimentos", async () => {
  const db = await openDatabase();
  const { ctx } = await build(db);
  const resultado = await runTool(ctx(), { name: "abertura" });
  const evidence = evidenceOf({ chamada: { name: "abertura" }, resultado });
  assert.equal(evidence.length, 5);
  assert.ok(evidence.every((e) => e.kind === "gasto_categoria" && e.population === "movimentos" && e.to === settledToday().slice(0, 7)));
  assert.deepEqual(evidence.map((e) => e.category), ["Mercado", "Lazer", "Casa", "Saúde", "Transporte"]);
});

test("rota aberta: o prefetch traz abertura e o modelo ainda recebe ferramentas_restantes 5; JUDITE_DIAG_PREFETCH=basic tira", async () => {
  const db = await openDatabase();
  const { l } = await build(db);
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "DASHSCOPE_API_KEY", "DASHSCOPE_MODEL", "DASHSCOPE_RETENTION_CONFIRMED", "JUDITE_TOOL_MODE", "DASHSCOPE_OPEN_MODEL", "JUDITE_OPEN_ROUTE", "JUDITE_DIAG_PREFETCH"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AI_PROVIDER: "dashscope", DASHSCOPE_API_KEY: "synthetic-key", DASHSCOPE_MODEL: "qwen3.8-flash", DASHSCOPE_RETENTION_CONFIRMED: "true", JUDITE_TOOL_MODE: "native" });
  for (const k of ["DASHSCOPE_OPEN_MODEL", "JUDITE_OPEN_ROUTE", "JUDITE_DIAG_PREFETCH"]) delete process.env[k];
  const sent: { messages: { role: string; content: unknown }[] }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "{}"));
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ text: "Sem novidades.", action: null }) } }] });
  }) as typeof fetch;
  const textOf = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("\n") : "");
  const firstTurn = () => {
    const turns = sent.at(-1)!.messages.filter((m) => m.role === "user").flatMap((m) => {
      try {
        return [JSON.parse(textOf(m.content)) as { tool_results?: { chamada: { name: string } }[]; ferramentas_restantes?: number }];
      } catch {
        return [];
      }
    });
    return turns.find((m) => m.ferramentas_restantes !== undefined)!;
  };
  const ask = { question: "E no mercado?", month: settledToday().slice(0, 7), currency: "BRL" as const, external: true, chat: true, history: [] };
  const diagnostic = { ...ask, question: "O que eu poderia fazer diferente nas finanças?" };
  try {
    await askHelp(db, l.user, ask);
    assert.deepEqual(firstTurn().tool_results?.map((r) => r.chamada.name), ["abertura", "proximas_decisoes"]);
    assert.equal(firstTurn().ferramentas_restantes, 5, "abertura não gasta orçamento; fora do diagnóstico o teto é 5");
    await askHelp(db, l.user, diagnostic);
    assert.deepEqual(firstTurn().tool_results?.map((r) => r.chamada.name), ["padroes", "renda_por_tipo", "avisos_de_dados", "abertura", "proximas_decisoes"]);
    assert.equal(firstTurn().ferramentas_restantes, 5, "só padroes gasta");
    process.env.JUDITE_DIAG_PREFETCH = "basic";
    await askHelp(db, l.user, ask);
    assert.equal(firstTurn().tool_results, undefined);
    assert.equal(firstTurn().ferramentas_restantes, 5);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
