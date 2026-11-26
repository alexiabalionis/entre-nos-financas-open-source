// Function Calling nativo (experimental): uma definição canônica, os mesmos
// limites e validações do protocolo JSON, chamadas e resultados pelo id do provedor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeTools, parseNativeCall, protocolShape } from "../src/server/judite-tools-native.ts";
import { toolCall } from "../src/server/judite-tools-schema.ts";
import { openDatabase } from "../src/server/db.ts";
import { askHelp } from "../src/server/help.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { COPILOTO_SCENARIOS } from "../scripts/judite-eval-copiloto.ts";

test("ferramentas nativas saem do schema canônico: mesmas 19, só leitura, sem o campo name", () => {
  const tools = nativeTools();
  const names = (toolCall.shape.tool as unknown as { options: { shape: { name: { value: string } } }[] }).options.map((o) => o.shape.name.value);
  assert.deepEqual(tools.map((t) => t.function.name), names);
  for (const t of tools) {
    assert.ok(t.function.description.length > 10, t.function.name);
    assert.equal((t.function.parameters as { type: string }).type, "object");
    assert.ok(!("name" in ((t.function.parameters as { properties?: object }).properties ?? {})), t.function.name);
  }
  // Nenhuma action de escrita vira ferramenta executável.
  for (const write of ["plan_create", "plan_edit", "event_create", "goal_create", "goal_contribute", "note_save", "category_protect", "memory_save", "memory_forget"])
    assert.ok(!names.includes(write), write);
  const inv = tools.find((t) => t.function.name === "investigar_gastos")!.function.parameters as { properties: Record<string, { items?: { enum?: string[] } }> };
  assert.ok(inv.properties.operacoes!.items!.enum!.includes("forma_pagamento"));
});

test("argumentos nativos passam pela mesma validação do protocolo JSON", () => {
  const call = (name: string, args: string) => parseNativeCall({ id: "x", type: "function", function: { name, arguments: args } });
  const ok = call("investigar_gastos", '{"operacoes":["forma_pagamento"],"categoria":"c0"}');
  assert.ok(ok.ok && ok.call.name === "investigar_gastos");
  assert.ok(call("sobra_atual", "").ok, "sem argumentos vale {}");
  const refine = call("investigar_gastos", '{"operacoes":["distribuicao"]}');
  assert.ok(!refine.ok && /eixo/.test(refine.error), "a regra do refine continua");
  assert.ok(!call("investigar_gastos", '{"operacoes":["x"],"sql":"select 1"}').ok);
  assert.ok(!call("plan_create", '{"label":"x"}').ok, "escrita não existe como ferramenta");
  assert.ok(!call("padroes", "{nao é json").ok);
});

test("diagnóstico de resposta fora do protocolo não leva valor nem nome", () => {
  const raw = '[{"tool":{"name":"buscar_movimentos","texto":"Maria Silva","de":"2026-10-01"}},{"text":"Sobram R$ 3.310,00"}]';
  const s = protocolShape(raw);
  assert.equal(s.tipo, "lista");
  assert.doesNotMatch(s.forma, /Maria|3\.310|2026|buscar_movimentos/);
  assert.match(s.forma, /"tool":/);
  assert.equal(protocolShape('{"text":"cortad').tipo, "json_cortado");
});

// Provedor DashScope falso com Function Calling: devolve as respostas em ordem e guarda cada corpo enviado.
function fakeDashscope(replies: Record<string, unknown>[]) {
  const bodies: { messages: Record<string, unknown>[]; tools?: unknown[]; tool_choice?: string; parallel_tool_calls?: boolean }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"));
    const message = replies[Math.min(bodies.length - 1, replies.length - 1)]!;
    return Response.json({ choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }] });
  }) as typeof fetch;
  return bodies;
}
const fc = (id: string, name: string, args: Record<string, unknown> = {}) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
/** Texto de uma mensagem enviada: string ou partes (com marcador de cache). */
const textOf = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("\n") : String(c ?? ""));

async function withNative(run: () => Promise<void>) {
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "DASHSCOPE_API_KEY", "DASHSCOPE_MODEL", "DASHSCOPE_RETENTION_CONFIRMED", "JUDITE_TOOL_MODE", "JUDITE_OPEN_MAX_TOOLS", "JUDITE_FINAL_CONTEXT", "DASHSCOPE_OPEN_MODEL", "JUDITE_FINAL_KEEP_TOOLS", "JUDITE_PROMPT", "JUDITE_OPEN_OPT", "JUDITE_SAMPLING", "JUDITE_CACHE_CONVO", "JUDITE_FINAL_SHORT", "JUDITE_NUMBER_LIMIT"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AI_PROVIDER: "dashscope", DASHSCOPE_API_KEY: "synthetic-key", DASHSCOPE_MODEL: "qwen3.8-flash", DASHSCOPE_RETENTION_CONFIRMED: "true", JUDITE_TOOL_MODE: "native" });
  try {
    await run();
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("laço nativo: chamadas paralelas e resultados casados pelo id; inválida e acima do orçamento também respondem", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const bodies = fakeDashscope([
      { role: "assistant", content: "", tool_calls: [fc("c1", "sobra_atual"), fc("c2", "investigar_gastos", { operacoes: ["distribuicao"] }), fc("c3", "mes_atual")] },
      { role: "assistant", content: "", tool_calls: ["d1", "d2", "d3", "d4", "d5"].map((id, k) => fc(id, ["reservas", "falta_pagar", "contas_fixas", "cartoes", "notas"][k]!)) },
      { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null }) },
    ]);
    const answer = (await askHelp(db, user, { question: "Quanto sobra por mês?", month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] })) as {
      text: string;
      trace: Record<string, unknown>;
    };
    assert.equal(answer.text, "Sobra estável.");
    assert.equal(bodies[0]!.tool_choice, "auto");
    assert.equal(bodies[0]!.parallel_tool_calls, true);
    assert.equal((bodies[0] as { response_format?: unknown }).response_format, undefined, "json_object não vai junto com tools");
    assert.equal(bodies[0]!.tools!.length, nativeTools().length);
    const second = bodies[1]!.messages;
    const toolMsgs = (ids: string[]) => ids.map((id) => second.find((m) => m.role === "tool" && m.tool_call_id === id));
    const [c1, c2, c3] = toolMsgs(["c1", "c2", "c3"]);
    assert.ok(c1 && c2 && c3, "cada chamada tem a resposta com o seu id");
    assert.match(String(c2!.content), /argumento inválido: .*eixo/);
    assert.match(String(c1!.content), /media|sobra|sem_historico|meses/i);
    // 6 ferramentas por pergunta: c1 + c2 (inválida) + c3 + d1..d3; d4 e d5 recebem "sem mais ferramentas".
    const third = bodies[2]!.messages;
    for (const id of ["d4", "d5"]) assert.match(String(third.find((m) => m.tool_call_id === id)!.content), /Sem mais ferramentas/);
    assert.equal(bodies[2]!.tool_choice, "none");
    assert.equal(answer.trace.nativas, 8);
    assert.equal(answer.trace.executadas, 5);
    assert.equal(answer.trace.invalidas, 1);
    assert.equal(answer.trace.modo_ferramentas, "native");
  });
});

test("laço nativo: o prefetch do diagnóstico chega numa mensagem; texto final passa pelas mesmas checagens", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const bodies = fakeDashscope([
      { role: "assistant", content: JSON.stringify({ text: "Impacto: estimamos uma economia potencial de R$ 400,00 por mês.", action: null, hipoteses: [{ hipotese: "Pix", status: "observacao", evidencias: ["p0"] }] }) },
      { role: "assistant", content: JSON.stringify({ text: "Impacto: estimamos uma economia potencial de R$ 400,00 por mês.", action: null, hipoteses: [{ hipotese: "Pix", status: "observacao", evidencias: ["p0"] }] }) },
      { role: "assistant", content: JSON.stringify({ text: "A forma de pagamento mudou; não calculei economia.", action: null }) },
    ]);
    const answer = (await askHelp(db, user, {
      question: "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.",
      month: settledToday().slice(0, 7),
      currency: "BRL",
      external: true,
      chat: true,
      history: [],
    })) as { text: string };
    const firstUser = bodies[0]!.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
    assert.ok(firstUser.some((c) => c.includes('"name":"padroes"')), "o prefetch de padroes vai ao modelo");
    assert.doesNotMatch(answer.text, /economia potencial de R\$ 400/);
  });
});

test("experimento de latência: JUDITE_OPEN_MAX_TOOLS limita a rota aberta contando o prefetch; o resto não muda", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    process.env.JUDITE_OPEN_MAX_TOOLS = "5";
    const bodies = fakeDashscope([
      { role: "assistant", content: "", tool_calls: ["e1", "e2", "e3", "e4", "e5"].map((id, k) => fc(id, ["sobra_atual", "reservas", "falta_pagar", "contas_fixas", "cartoes"][k]!)) },
      { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null, hipoteses: [] }) },
    ]);
    const answer = (await askHelp(db, user, {
      question: "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.",
      month: settledToday().slice(0, 7),
      currency: "BRL",
      external: true,
      chat: true,
      history: [],
    })) as { trace: Record<string, unknown> };
    // padroes (prefetch) + 4 do modelo = 5; renda_por_tipo, avisos_de_dados, abertura e proximas_decisoes são prefetch fora do orçamento (prefetch 5, executadas 5).
    assert.equal(answer.trace.limite_ferramentas, 5);
    assert.equal(answer.trace.prefetch, 5);
    assert.equal(answer.trace.executadas, 5);
    assert.match(textOf(bodies[1]!.messages.find((m) => m.tool_call_id === "e5")!.content), /Sem mais ferramentas/);
    assert.equal(bodies[1]!.tool_choice, "auto", "a rota aberta mantém as ferramentas na resposta final (cache)");
  });
});

test("contexto de finalização: padrão na rota aberta, uma vez, na ida da resposta final; JUDITE_FINAL_CONTEXT=0 desliga; outras rotas nunca recebem", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  const question = "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.";
  const ask = () => askHelp(db, user, { question, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] }) as Promise<{ trace: Record<string, unknown> }>;
  const replies = [
    { role: "assistant", content: "", tool_calls: ["e1", "e2", "e3", "e4", "e5"].map((id, k) => fc(id, ["sobra_atual", "reservas", "falta_pagar", "contas_fixas", "cartoes"][k]!)) },
    // 1ª final com hipótese que a conferência recusa: força a volta, que não pode levar o contexto de novo.
    { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null, hipoteses: [{ hipotese: "x", status: "observacao", evidencias: [], beneficio: "custo" }] }) },
    { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null, hipoteses: [{ hipotese: "x", status: "observacao", evidencias: ["p0"] }] }) },
  ];
  const withContext = (b: { messages: Record<string, unknown>[] }) => b.messages.filter((m) => m.role === "user" && textOf(m.content).includes("contexto_finalizacao")).length;
  await withNative(async () => {
    const bodies = fakeDashscope(replies);
    const answer = await ask();
    assert.equal(answer.trace.rota, "aberta");
    assert.equal(withContext(bodies[0]!), 0, "não vai enquanto há ferramentas");
    assert.equal(withContext(bodies[1]!), 1, "vai na ida da resposta final");
    assert.equal(withContext(bodies[2]!), 1, "a volta de conferência não repete");
    const sent = JSON.parse(textOf(bodies[1]!.messages.find((m) => textOf(m.content).includes("contexto_finalizacao"))!.content)).contexto_finalizacao;
    assert.ok(sent.hipoteses.refs_existentes.includes("p0"));
    assert.ok(Number(answer.trace.contexto_finalizacao) > 0);
    assert.ok((answer.trace.hipoteses_problemas as string[]).length > 0, "a conferência continua valendo");
  });
  await withNative(async () => {
    process.env.JUDITE_FINAL_CONTEXT = "0";
    const bodies = fakeDashscope(replies);
    const answer = await ask();
    assert.ok(bodies.every((b) => withContext(b) === 0));
    assert.equal(answer.trace.contexto_finalizacao, 0);
    assert.ok((answer.trace.hipoteses_problemas as string[]).length > 0, "a conferência é a mesma sem o contexto");
  });
  // Rota padrão: o diagnóstico com o roteamento desligado e a pergunta comum nunca recebem o contexto.
  await withNative(async () => {
    process.env.DASHSCOPE_OPEN_MODEL = "off";
    const bodies = fakeDashscope(replies);
    const answer = await ask();
    assert.equal(answer.trace.rota, "padrao");
    assert.ok(bodies.every((b) => withContext(b) === 0));
    assert.equal(answer.trace.contexto_finalizacao, 0);
  });
  await withNative(async () => {
    const bodies = fakeDashscope([replies[0]!, { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null }) }]);
    const answer = (await askHelp(db, user, { question: "Quanto sobra por mês?", month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] })) as { trace: Record<string, unknown> };
    assert.equal(answer.trace.rota, "padrao");
    assert.ok(bodies.every((b) => withContext(b) === 0));
    assert.equal(answer.trace.contexto_finalizacao, 0);
  });
});

test("JUDITE_FINAL_KEEP_TOOLS: a resposta final mantém tool_choice auto; pedido de ferramenta depois disso recebe 'sem mais' e a ida seguinte volta a none", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  const question = "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.";
  const five = { role: "assistant", content: "", tool_calls: ["e1", "e2", "e3", "e4", "e5"].map((id, k) => fc(id, ["sobra_atual", "reservas", "falta_pagar", "contas_fixas", "cartoes"][k]!)) };
  const final = { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null, hipoteses: [{ hipotese: "x", status: "observacao", evidencias: ["p0"] }] }) };
  await withNative(async () => {
    process.env.JUDITE_FINAL_KEEP_TOOLS = "1";
    const bodies = fakeDashscope([five, { role: "assistant", content: "", tool_calls: [fc("z1", "notas")] }, final]);
    const answer = (await askHelp(db, user, { question, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] })) as { text: string };
    assert.equal(bodies[1]!.tool_choice, "auto");
    assert.match(String(bodies[2]!.messages.find((m) => m.tool_call_id === "z1")!.content), /Sem mais ferramentas/);
    assert.equal(bodies[2]!.tool_choice, "none");
    assert.equal(answer.text, "Sobra estável.");
  });
  await withNative(async () => {
    process.env.JUDITE_OPEN_OPT = "off";
    const bodies = fakeDashscope([five, final]);
    await askHelp(db, user, { question, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    assert.equal(bodies[1]!.tool_choice, "none", "com JUDITE_OPEN_OPT=off, como antes");
  });
  await withNative(async () => {
    const bodies = fakeDashscope([five, final]);
    await askHelp(db, user, { question, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    assert.equal(bodies[1]!.tool_choice, "auto", "padrão da rota aberta");
    assert.doesNotMatch(JSON.stringify(bodies[0]!.messages[0]!.content), /- \{\\"tool\\":\{\\"name\\":\\"sobra_atual/, "prompt enxuto por padrão na rota aberta");
    assert.equal((bodies[0] as Record<string, unknown>).temperature, 0.7, "amostragem do cartão (qwen4-max sem pensar)");
  });
});

test("pensamento preservado: reasoning_content da chamada de ferramenta volta na mensagem do assistente", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const bodies = fakeDashscope([
      { role: "assistant", content: "", reasoning_content: "pensei", tool_calls: [fc("r1", "sobra_atual")] },
      { role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null }) },
    ]);
    await askHelp(db, user, { question: "Quanto sobra por mês?", month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    const assistant = bodies[1]!.messages.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    assert.equal(assistant!.reasoning_content, "pensei");
  });
});

test("prompt enxuto só no modo nativo com JUDITE_PROMPT=compact: sem as linhas de ferramenta no system", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  const system = (b: { messages: Record<string, unknown>[] }) => JSON.stringify(b.messages[0]!.content);
  const reply = [{ role: "assistant", content: JSON.stringify({ text: "Sobra estável.", action: null }) }];
  await withNative(async () => {
    process.env.JUDITE_PROMPT = "compact";
    const bodies = fakeDashscope(reply);
    await askHelp(db, user, { question: "Quanto sobra por mês?", month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    assert.doesNotMatch(system(bodies[0]!), /- \{\\"tool\\":\{\\"name\\":\\"sobra_atual/);
    assert.ok((bodies[0]!.tools as { function: { description: string } }[]).find((t) => t.function.description.length > 1000));
  });
  await withNative(async () => {
    const bodies = fakeDashscope(reply);
    await askHelp(db, user, { question: "Quanto sobra por mês?", month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] });
    assert.match(system(bodies[0]!), /- \{\\"tool\\":\{\\"name\\":\\"sobra_atual/);
  });
});

const DIAG = "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.";
const SIX = "Entrou R$ 11,11, saiu R$ 22,22, sobrou R$ 33,33, a fatura é R$ 44,44, o Pix R$ 55,55 e o mercado R$ 66,66.";
const askDiag = (db: Awaited<ReturnType<typeof openDatabase>>, user: Parameters<typeof askHelp>[1], question = DIAG) =>
  askHelp(db, user, { question, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] }) as Promise<{
    text: string;
    contas?: string | null;
    trace: Record<string, unknown>;
  }>;
const final = (text: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content: JSON.stringify({ text, action: null, hipoteses: [], ...extra }) });

/** Relógio virtual: cada ida ao provedor falso custa `ms` do orçamento, sem esperar de verdade. */
function slowProvider(ms: number) {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  Date.now = () => realNow() + offset;
  const inner = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    offset += ms;
    return inner(...args);
  }) as typeof fetch;
  return () => {
    Date.now = realNow;
  };
}

test("limite de números: desligado por padrão, a resposta com muitos valores passa sem reescrita", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const bodies = fakeDashscope([final(SIX)]);
    const answer = await askDiag(db, user);
    assert.equal(answer.trace.reescrita_numeros ?? 0, 0);
    assert.ok(!bodies.some((b) => /limite é/.test(textOf(b.messages.at(-1)!.content))));
  });
});

test("limite de números: diagnóstico com 6 valores pede uma reescrita que leva o detalhe para contas", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    process.env.JUDITE_NUMBER_LIMIT = "1";
    const bodies = fakeDashscope([final(SIX), final("Sobrou pouco no mês.", { contas: "Entrou menos que saiu." })]);
    const answer = await askDiag(db, user);
    assert.equal(bodies.length, 2, "uma reescrita, não mais");
    assert.match(textOf(bodies[1]!.messages.at(-1)!.content), /limite é 5/);
    assert.equal(answer.text, "Sobrou pouco no mês.");
    assert.equal(answer.contas, "Entrou menos que saiu.");
    assert.equal(answer.trace.reescrita_numeros, 1);
    assert.equal(answer.trace.numeros_no_texto, null);
  });
});

test("limite de números: fora do diagnóstico o limite é 2; se a reescrita ainda passar, aceita e registra", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    process.env.JUDITE_NUMBER_LIMIT = "1";
    const three = "Entrou R$ 11,11, saiu R$ 22,22 e sobrou 33% do mês.";
    const bodies = fakeDashscope([final(three), final(three)]);
    const answer = await askDiag(db, user, "Quanto sobra por mês?");
    // 2 idas do laço (a resposta e a reescrita) e 1 do reparo de origem (os valores são fictícios).
    assert.equal(bodies.length, 3);
    assert.match(textOf(bodies[1]!.messages.at(-1)!.content), /limite é 2/);
    assert.equal(answer.trace.reescrita_numeros, 1);
    assert.equal(answer.trace.numeros_no_texto, 3);
  });
});

test("limite de números: sem tempo no orçamento não reescreve e registra", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    process.env.JUDITE_NUMBER_LIMIT = "1";
    const bodies = fakeDashscope([final(SIX)]);
    // A rota aberta usa o modelo de investigação (orçamento de 150 s): uma ida de 200 s já passa do prazo.
    const restore = slowProvider(200_000);
    try {
      const answer = await askDiag(db, user);
      assert.equal(bodies.length, 1);
      assert.equal(answer.trace.reescrita_numeros, 0);
      assert.equal(answer.trace.numeros_no_texto, 6);
      assert.deepEqual(answer.trace.sem_tempo, ["numeros", "reparo"]);
    } finally {
      restore();
    }
  });
});

test("orçamento de tempo: reparo de origem e retentativa de hipóteses não rodam depois do prazo", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const bad = final("Sobram R$ 987,65 por mês.", { hipoteses: [{ hipotese: "Pix", status: "observacao", evidencias: ["p99"] }] });
    const bodies = fakeDashscope([bad]);
    const restore = slowProvider(100_000);
    try {
      const answer = await askDiag(db, user);
      // 1ª ida (100 s): dentro dos 150 s, pede a conferência das hipóteses. 2ª ida (200 s): passou do prazo, então nem reparo nem 3ª ida.
      assert.equal(bodies.length, 2);
      assert.deepEqual(answer.trace.sem_tempo, ["reparo"]);
      assert.doesNotMatch(answer.text, /987,65/);
    } finally {
      restore();
    }
  });
});

test("contas: valor sem origem em contas é bloqueado como no text", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    const reply = final("Sobrou pouco no mês.", { contas: "Entrou menos que saiu.\nCarro: R$ 987,65 por mês." });
    const bodies = fakeDashscope([reply, reply]);
    const answer = await askDiag(db, user);
    assert.ok(bodies.length >= 2, "o reparo de origem foi pedido");
    assert.match(JSON.stringify(bodies[1]!.messages.at(-1)), /contas_anterior/);
    assert.doesNotMatch(answer.contas ?? "", /987,65/);
    assert.match(answer.contas ?? "", /Entrou menos que saiu/);
    assert.ok((answer.trace.sem_origem as string[]).some((v) => v.includes("987,65")));
  });
});

test("JUDITE_FORMAT=classic: sem limite de números e sem contas", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  await withNative(async () => {
    process.env.JUDITE_FORMAT = "classic";
    try {
      const bodies = fakeDashscope([final("Entrou R$ 11,11, saiu R$ 22,22 e sobrou 33%.", { contas: "Detalhe." })]);
      const answer = await askDiag(db, user, "Quanto sobra por mês?");
      assert.ok(bodies.every((b) => !/limite é/.test(textOf(b.messages.at(-1)!.content))), "nenhuma reescrita por números");
      assert.equal(answer.contas, null);
      assert.equal(answer.trace.reescrita_numeros, 0);
    } finally {
      delete process.env.JUDITE_FORMAT;
    }
  });
});
