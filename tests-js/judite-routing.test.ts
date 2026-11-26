// Decisões de 22/11/2026: a conferência de padrão nunca apaga resposta; o
// travessão é trocado no código; diagnóstico aberto vai para o modelo de
// investigação com Function Calling nativo, o resto fica no modelo de sempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPatterns, type PatternRef } from "../src/domain/pattern-check.ts";
import { withoutDashes } from "../src/server/help.ts";
import { routeFor } from "../src/server/judite-tools-native.ts";
import { OPEN_QUESTION } from "../scripts/judite-eval-copiloto.ts";

const inv: PatternRef = { analise: "investigar_gastos", corte: "recorrencias", recorte: { tipo: "escopo", chave: "{}" }, tags: ["recorrencia", "dia:segunda"] };

test("padrão sustentado por qualquer resultado da pergunta passa sem etiqueta; sem base pede reescrita mas não apaga", () => {
  const refs = new Map([["i0", inv]]);
  const ok = checkPatterns("Um Pix de R$ 180,00 para o mesmo destinatário, toda segunda-feira.", refs);
  assert.deepEqual(ok.rejected, []);
  assert.equal(ok.untagged.length, 1);
  assert.equal(ok.text, "Um Pix de R$ 180,00 para o mesmo destinatário, toda segunda-feira.");
  const bad = checkPatterns("Vocês pedem delivery na sexta à noite.", refs);
  assert.equal(bad.rejected.length, 1);
  assert.equal(bad.text, "Vocês pedem delivery na sexta à noite.", "o texto não ganha marcador nem perde a frase");
  // Etiqueta errada, mas outro resultado sustenta o que a frase diz: passa.
  const p0: PatternRef = { analise: "concentracao_tempo", corte: "parte_do_mes: fim", recorte: { tipo: "casa", chave: "casa" } };
  assert.deepEqual(checkPatterns("A faxina é paga toda segunda {{p0}}.", new Map([["p0", p0], ["i0", inv]])).rejected, []);
});

test("travessão vira vírgula entre palavras e hífen entre números; o resto não muda", () => {
  assert.equal(withoutDashes("Sobra estável — sem mês negativo."), "Sobra estável, sem mês negativo.");
  assert.equal(withoutDashes("De maio–julho e 2026—2027."), "De maio, julho e 2026-2027.");
  assert.equal(withoutDashes("— primeiro item\n— segundo"), "- primeiro item\n- segundo");
  assert.equal(withoutDashes("Texto sem traço - hífen normal."), "Texto sem traço - hífen normal.");
});

test("roteamento: diagnóstico aberto → qwen4-max nativo; o resto → modelo de sempre em JSON; off desliga", () => {
  const keys = ["DASHSCOPE_OPEN_MODEL", "JUDITE_TOOL_MODE", "JUDITE_OPEN_MAX_TOOLS", "JUDITE_OPEN_ROUTE"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    delete process.env.DASHSCOPE_OPEN_MODEL;
    delete process.env.JUDITE_TOOL_MODE;
    delete process.env.JUDITE_OPEN_MAX_TOOLS;
    // Comportamento do detector de diagnóstico (a rota solta tem o próprio teste abaixo).
    process.env.JUDITE_OPEN_ROUTE = "diagnostic";
    const ds = { chat: "dashscope", model: "qwen3.8-flash" };
    assert.deepEqual(routeFor(OPEN_QUESTION, ds), { model: "qwen4-max", mode: "native", rota: "aberta" });
    for (const q of ["Quanto gastamos com iFood no mês passado?", "O que falta pagar?", "Tem algum padrão no delivery?"])
      assert.deepEqual(routeFor(q, ds), { model: "qwen3.8-flash", mode: "json", rota: "padrao" }, q);
    process.env.DASHSCOPE_OPEN_MODEL = "off";
    assert.equal(routeFor(OPEN_QUESTION, ds).model, "qwen3.8-flash");
    process.env.DASHSCOPE_OPEN_MODEL = "qwen3.8-max";
    assert.equal(routeFor(OPEN_QUESTION, ds).model, "qwen3.8-max");
    assert.deepEqual(routeFor(OPEN_QUESTION, { chat: "groq", model: "gpt" }), { model: "gpt", mode: "json", rota: "padrao" });
    // Experimento de latência: teto só na rota aberta; valor fora de 1..MAX_TOOL_CALLS é ignorado.
    delete process.env.DASHSCOPE_OPEN_MODEL;
    process.env.JUDITE_OPEN_MAX_TOOLS = "5";
    assert.equal(routeFor(OPEN_QUESTION, ds).maxTools, 5);
    assert.equal(routeFor("O que falta pagar?", ds).maxTools, undefined);
    for (const bad of ["0", "7", "x"]) {
      process.env.JUDITE_OPEN_MAX_TOOLS = bad;
      assert.equal(routeFor(OPEN_QUESTION, ds).maxTools, undefined, bad);
    }
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("otimizações: padrão só na rota aberta; JUDITE_OPEN_OPT=off e as variáveis individuais desligam", async () => {
  const { routeOptions } = await import("../src/server/judite-tools-native.ts");
  const keys = ["JUDITE_OPEN_OPT", "JUDITE_PROMPT", "JUDITE_SAMPLING", "JUDITE_CACHE_CONVO", "JUDITE_FINAL_KEEP_TOOLS", "JUDITE_FINAL_SHORT"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.deepEqual(routeOptions("aberta", "native"), { compact: true, sampling: "cartao", cacheConversation: true, keepTools: true, finalShort: true });
    assert.deepEqual(routeOptions("padrao", "json"), { compact: false, cacheConversation: false, keepTools: false, finalShort: false });
    assert.deepEqual(routeOptions("padrao", "native"), { compact: false, cacheConversation: false, keepTools: false, finalShort: false });
    process.env.JUDITE_FINAL_SHORT = "0";
    process.env.JUDITE_PROMPT = "full";
    const some = routeOptions("aberta", "native");
    assert.equal(some.finalShort, false);
    assert.equal(some.compact, false);
    assert.equal(some.keepTools, true);
    process.env.JUDITE_OPEN_OPT = "off";
    assert.deepEqual(routeOptions("aberta", "native"), { compact: false, cacheConversation: false, keepTools: false, finalShort: false });
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("diagnóstico: as perguntas reais de 23/11/2026 entram; continuação herda; factual e ação ficam fora", async () => {
  const { openDiagnosticIntent, diagnosticIntent } = await import("../src/server/judite-evidence.ts");
  for (const q of [
    "Faça uma avaliação das minhas contas fixas e compromissos recorrentes e me ajude a encontrar formas de aumentar o que sobra por mes. Não quero as sugestões obvias.",
    "Hoje tem uma sobra de aproximadamente 4%. Quero elevar para 10% inicialmente. Depois ir aumentando gradualmente com mais economias.",
    "Reduzir o que dentro dessa categoria? São mais complicadas de mexer. Categorias mais variaveis são mais possiveis. Mas quero que analise cada compra, padrões que se repetem e impactam negativamente",
    "Onde dá para economizar?",
    "Como fazer sobrar mais dinheiro?",
    // 23/11/2026, depois das lacunas: caíam na rota padrão e saíam rasas.
    "Me de uma analise detalhada do que ta impactando mais negativamente minhas finanças",
    "Vamos pensar em estrategias que possam me ajudar a ter maior controle, maior facilidade de me manter dentro do planejado. Fora do obvio.",
    "O que está pesando no nosso orçamento?",
  ])
    assert.ok(openDiagnosticIntent(q), q);
  for (const q of [
    "Quanto gastei com iFood no mês passado?",
    "O que falta pagar?",
    "Quais foram os maiores gastos do mês passado?",
    "Tem algum padrão no delivery?",
    "Dá para guardar R$ 500 por mês?",
    "Compras pessoais, alimentação fora",
    "Quero sobrar 6% por mês",
    "Quanto o mercado pesa no orçamento este mês?",
    "Quanto ficou o planejado de Lazer?",
  ])
    assert.ok(!openDiagnosticIntent(q), q);
  const after = [
    { role: "user", text: "Analise meus gastos variáveis" },
    { role: "assistant", text: "Síntese: a sobra é de 3,8%.\n\nO que percebi: ..." },
  ];
  assert.ok(diagnosticIntent("Compras pessoais, alimentação fora", after));
  assert.ok(!diagnosticIntent("Compras pessoais, alimentação fora", []));
  assert.ok(!diagnosticIntent("Quanto gastei com Compras pessoais em outubro?", after), "factual no meio do diagnóstico");
  assert.ok(!diagnosticIntent("Registra um gasto de R$ 50 no mercado", after), "ação");
  assert.ok(!diagnosticIntent("Compras pessoais", [{ role: "user", text: "O que falta pagar?" }, { role: "assistant", text: "Falta a fatura." }]));
  // 23/11/2026: o chat real perdia o diagnóstico na 3ª mensagem ("Esse output não me ajuda", depois "Quero ajuda para...").
  const chat = [
    { role: "user", text: "Analise nossas finanças e me diga onde melhorar" },
    { role: "assistant", text: "A fatura vence dia 26." },
    { role: "user", text: "Esse output não me ajuda muito a tomar decisões" },
    { role: "assistant", text: "O que falta para ajudar?" },
  ];
  assert.ok(diagnosticIntent("Quero ajuda para entender o que fazer para economizar ou ter uma visão melhor dos gastos", chat));
});

test("rota aberta solta: toda pergunta com IA, menos as curtas; JUDITE_OPEN_ROUTE=diagnostic volta ao detector", async () => {
  const { quickIntent, initialPrefetch } = await import("../src/server/judite-evidence.ts");
  const keys = ["DASHSCOPE_OPEN_MODEL", "JUDITE_TOOL_MODE", "JUDITE_OPEN_MAX_TOOLS", "JUDITE_OPEN_ROUTE", "GROK_OPEN_ROUTE"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    const ds = { chat: "dashscope", model: "qwen3.8-flash" };
    const aberta = { model: "qwen4-max", mode: "native", rota: "aberta" };
    assert.deepEqual(routeFor("Me dê uma análise detalhada do que está impactando minhas finanças", ds), aberta);
    // Fora do diagnóstico não há padroes no prefetch: o teto fica em 5 para o modelo ter as mesmas 5 chamadas.
    for (const q of ["E no mercado?", "Dá para guardar R$ 500?"])
      assert.deepEqual(routeFor(q, ds), { ...aberta, maxTools: 5 }, q);
    for (const q of ["Quanto gastei com iFood em outubro?", "O que falta pagar?", "Registra um gasto de R$ 50", "Quanto sobra no planejamento?", "Como estão nossos investimentos?"]) {
      assert.ok(quickIntent(q), q);
      assert.deepEqual(routeFor(q, ds), { model: "qwen3.8-flash", mode: "json", rota: "padrao" }, q);
    }
    // Grok também solta a rota; GROK_OPEN_ROUTE=off segue desligando.
    const grok = { chat: "grok", model: "grok-4.3" };
    assert.equal(routeFor("E no mercado?", grok).rota, "aberta");
    process.env.GROK_OPEN_ROUTE = "off";
    assert.equal(routeFor("E no mercado?", grok).rota, "padrao");
    delete process.env.GROK_OPEN_ROUTE;
    process.env.JUDITE_OPEN_ROUTE = "diagnostic";
    assert.equal(routeFor("E no mercado?", ds).rota, "padrao");
    assert.equal(routeFor(OPEN_QUESTION, ds).rota, "aberta");
    // Pergunta aberta que não é diagnóstico: sem padroes no prefetch.
    assert.ok(!initialPrefetch({ question: "Dá para guardar R$ 500?", activeMemories: 0, diagnostic: false }).some((c) => c.name === "padroes"));
    assert.ok(initialPrefetch({ question: OPEN_QUESTION, activeMemories: 0, diagnostic: true }).some((c) => c.name === "padroes"));
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("prompt enxuto: o roteiro fica fora só no diagnóstico", async () => {
  const { compactToolsPrompt } = await import("../src/server/judite-tools-native.ts");
  assert.doesNotMatch(compactToolsPrompt(), /^Roteiro:/m);
  assert.match(compactToolsPrompt(true), /^Roteiro:/m);
});

test("formato livre no prompt; JUDITE_FORMAT=classic devolve o texto antigo", async () => {
  const { toolsPrompt, TOOLS_PROMPT } = await import("../src/server/judite-tools-schema.ts");
  const { compactToolsPrompt } = await import("../src/server/judite-tools-native.ts");
  const novo = toolsPrompt();
  for (const frase of ["Forma: livre", "Proponha ideias suas", "deficit_estrutural", "regras internas", '"contas":"..."', "hipoteses"]) {
    assert.ok(novo.includes(frase), frase);
  }
  // 23/11/2026: sem títulos fixos nem teto de números por bloco (esvaziavam a resposta).
  for (const fixo of ["A próxima decisão:", "1 por sugestão", "Onde vocês estão (1 ou 2 frases)"]) assert.ok(!novo.includes(fixo), fixo);
  assert.doesNotMatch(novo, /Forma: Síntese:/);
  assert.match(compactToolsPrompt(), /"contas":"\.\.\."/);
  process.env.JUDITE_FORMAT = "classic";
  try {
    assert.equal(toolsPrompt(), TOOLS_PROMPT);
    assert.match(TOOLS_PROMPT, /Forma: Síntese:, depois até 3 oportunidades/);
    assert.doesNotMatch(compactToolsPrompt(), /"contas":/);
  } finally {
    delete process.env.JUDITE_FORMAT;
  }
});
