// Perfis dos modelos e otimizações da parte 6: sem variável de ambiente, o pedido não muda.
import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletionsPayload } from "../src/server/llm.ts";
import { effortFor, explicitCache, parseModel } from "../src/server/llm-profiles.ts";
import { compactToolsPrompt, nativeTools } from "../src/server/judite-tools-native.ts";
import { TOOLS_PROMPT } from "../src/server/judite-tools-schema.ts";

const payload = (model: string, extra: Record<string, unknown> = {}) => ({ model, instructions: "i", input: "{}", json: true, max_output_tokens: 3000, ...extra });
function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  try {
    for (const [k, v] of Object.entries(vars)) set(k, v);
    run();
  } finally {
    for (const [k, v] of Object.entries(old)) set(k, v);
  }
}
const clean = { JUDITE_SAMPLING: undefined, JUDITE_EXPLICIT_CACHE_ALL: undefined, JUDITE_CACHE_CONVO: undefined };

test("sem variáveis: nenhum parâmetro novo no pedido (comportamento anterior)", () =>
  withEnv(clean, () => {
    for (const m of ["qwen3.8-flash", "qwen4-max", "qwen3.8-27b"]) {
      const body = chatCompletionsPayload(payload(m), "dashscope") as Record<string, unknown>;
      for (const k of ["temperature", "top_p", "top_k", "presence_penalty", "reasoning_effort", "preserve_thinking"]) assert.equal(body[k], undefined, `${m} ${k}`);
      assert.equal(body.enable_thinking, false);
    }
    // qwen3.8-flash continua sem cache explícito (mensagens em texto simples).
    const flash = chatCompletionsPayload(payload("qwen3.8-flash"), "dashscope") as { messages: { content: unknown }[] };
    assert.equal(typeof flash.messages[0]!.content, "string");
  }));

test(":thinking-low liga o pensamento com reasoning_effort e preserve_thinking; :thinking continua com o teto de 4000", () =>
  withEnv(clean, () => {
    assert.deepEqual(parseModel("qwen4-max:thinking-low"), { id: "qwen4-max", thinking: true, effort: "low" });
    const low = chatCompletionsPayload(payload("qwen4-max:thinking-low"), "dashscope") as Record<string, unknown>;
    assert.equal(low.model, "qwen4-max");
    assert.equal(low.enable_thinking, true);
    assert.equal(low.reasoning_effort, "low");
    assert.equal(low.preserve_thinking, true);
    assert.equal(low.thinking_budget, undefined);
    assert.equal(low.response_format, undefined);
    const old = chatCompletionsPayload(payload("qwen3.7-plus:thinking"), "dashscope") as Record<string, unknown>;
    assert.equal(old.thinking_budget, 4000);
    assert.equal(old.reasoning_effort, undefined);
    // Esforço que o modelo não conhece vai para o mais próximo acima (como a Alibaba mapeia).
    assert.equal(effortFor("qwen4-max", "medium"), "high");
    assert.equal(effortFor("qwen3.8-27b", "medium"), "medium");
    assert.equal(effortFor("qwen3.8-27b", "high"), "xhigh");
  }));

test("JUDITE_SAMPLING: cartão do fabricante por modo; 'preciso' só sem pensar", () => {
  withEnv({ ...clean, JUDITE_SAMPLING: "cartao" }, () => {
    const instruct = chatCompletionsPayload(payload("qwen4-max"), "dashscope") as Record<string, unknown>;
    assert.deepEqual([instruct.temperature, instruct.top_p, instruct.presence_penalty], [0.7, 0.8, 1.5]);
    const think = chatCompletionsPayload(payload("qwen3.8-27b:thinking-low"), "dashscope") as Record<string, unknown>;
    assert.deepEqual([think.temperature, think.top_p, think.presence_penalty], [1.0, 0.95, 0]);
  });
  withEnv({ ...clean, JUDITE_SAMPLING: "preciso" }, () => {
    const instruct = chatCompletionsPayload(payload("qwen3.8-flash"), "dashscope") as Record<string, unknown>;
    assert.deepEqual([instruct.temperature, instruct.presence_penalty], [0.3, 0]);
    const think = chatCompletionsPayload(payload("qwen4-max:thinking-low"), "dashscope") as Record<string, unknown>;
    assert.equal(think.temperature, 1.0, "pensando, vale o cartão");
  });
  withEnv({ ...clean, JUDITE_SAMPLING: "cartao" }, () => {
    const other = chatCompletionsPayload(payload("deepseek-v4.1-flash"), "dashscope") as Record<string, unknown>;
    assert.equal(other.temperature, undefined, "modelo sem perfil não muda");
  });
});

test("JUDITE_EXPLICIT_CACHE_ALL liga o cache explícito em qwen3.8-flash e qwen3.8-27b; JUDITE_CACHE_CONVO marca a última mensagem da conversa", () => {
  withEnv({ ...clean, JUDITE_EXPLICIT_CACHE_ALL: "1" }, () => {
    assert.ok(explicitCache("qwen3.8-flash") && explicitCache("qwen3.8-27b"));
    const body = chatCompletionsPayload(payload("qwen3.8-flash"), "dashscope") as { messages: { content: unknown }[] };
    assert.ok(Array.isArray(body.messages[0]!.content));
  });
  const conversation = [
    { role: "user" as const, content: "r1" },
    { role: "assistant" as const, content: "", tool_calls: [] },
    { role: "tool" as const, tool_call_id: "c1", content: "r2" },
  ];
  withEnv({ ...clean, JUDITE_CACHE_CONVO: "1" }, () => {
    const body = chatCompletionsPayload(payload("qwen4-max", { conversation, tools: nativeTools() }), "dashscope") as { messages: { role: string; content: unknown }[] };
    const marked = body.messages.filter((m) => JSON.stringify(m.content).includes("cache_control"));
    assert.equal(marked.length, 3, "system, entrada e a última mensagem com texto");
    assert.equal(body.messages.at(-1)!.role, "tool");
  });
  withEnv(clean, () => {
    const body = chatCompletionsPayload(payload("qwen4-max", { conversation, tools: nativeTools() }), "dashscope") as { messages: { content: unknown }[] };
    assert.equal(body.messages.filter((m) => JSON.stringify(m.content).includes("cache_control")).length, 2);
  });
});

test("prompt enxuto: sem as linhas de ferramenta nem o roteiro; descrições nativas inteiras; o resto do texto igual", () => {
  const compact = compactToolsPrompt();
  assert.ok(compact.length < TOOLS_PROMPT.length - 8000);
  assert.doesNotMatch(compact, /^- \{"tool"/m);
  assert.doesNotMatch(compact, /^Roteiro:/m);
  for (const keep of ["Memória:", "Padrões:", "Melhorar as finanças", "Explique cada passo"]) assert.ok(compact.includes(keep), keep);
  const desc = (full: boolean) => nativeTools(full).find((t) => t.function.name === "investigar_gastos")!.function.description;
  assert.equal(desc(false).length, 1000, "o corte antigo continua no modo de sempre");
  assert.ok(desc(true).length > 1000);
  assert.match(desc(true), /\{\{i0\}\}/, "a regra de etiqueta do fim da descrição chega ao modelo");
  assert.notEqual(nativeTools(true), nativeTools(false));
});

test("Grok (xAI): Responses API com esforço explícito, amostragem da xAI, raciocínio cifrado e chave de cache estável", async () => {
  const { llmConfig } = await import("../src/server/llm.ts");
  const { grokPayload, parseGrok } = await import("../src/server/llm-grok.ts");
  const { routeFor } = await import("../src/server/judite-tools-native.ts");
  const p = payload("grok-4.3-latest");
  const a = grokPayload(p, 3000) as Record<string, unknown>;
  assert.equal(a.model, "grok-4.3-latest");
  assert.deepEqual([a.temperature, a.top_p, (a.reasoning as { effort: string }).effort, a.store], [0.7, 0.95, "low", false]);
  assert.deepEqual(a.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(a.text, { format: { type: "json_object" } });
  assert.equal(a.prompt_cache_key, (grokPayload(p, 3000) as Record<string, unknown>).prompt_cache_key);
  assert.equal(a.prompt_cache_key, (grokPayload({ ...p, input: '{"outra":"pergunta"}' }, 3000) as Record<string, unknown>).prompt_cache_key, "a mesma chave em toda pergunta");
  assert.equal(((grokPayload(payload("grok-4.3-latest:thinking-high"), 3000) as Record<string, unknown>).reasoning as { effort: string }).effort, "high");
  // A conversa do laço vira itens: os itens crus do assistente (raciocínio cifrado) voltam iguais.
  const raw = [
    { type: "reasoning", encrypted_content: "cifra" },
    { type: "function_call", call_id: "c1", name: "sobra_atual", arguments: "{}" },
  ];
  const parsed = parseGrok({ status: "completed", output: raw });
  assert.deepEqual(parsed.toolCalls, [{ id: "c1", type: "function", function: { name: "sobra_atual", arguments: "{}" } }]);
  const next = grokPayload(
    {
      ...p,
      tools: nativeTools(),
      conversation: [
        { role: "user", content: "{}" },
        { role: "assistant", content: "", tool_calls: parsed.toolCalls, raw: parsed.raw },
        { role: "tool", tool_call_id: "c1", content: '{"ok":1}' },
      ],
    },
    3000,
  ) as { input: Record<string, unknown>[]; tools: Record<string, unknown>[]; text?: unknown };
  assert.deepEqual(next.input.slice(3), [...raw, { type: "function_call_output", call_id: "c1", output: '{"ok":1}' }]);
  assert.equal(next.tools[0]!.type, "function");
  assert.equal(typeof next.tools[0]!.name, "string", "ferramenta no formato plano da Responses API");
  assert.equal(next.text, undefined, "com ferramentas, o JSON final fica só no prompt");
  assert.equal(parseGrok({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }).content, "ok");
  assert.throws(() => parseGrok({ status: "incomplete", output: [] }));
  withEnv({ AI_PROVIDER: "grok", GROK_API_KEY: "k", GROK_MODEL: "grok-4.3-latest", GROK_RETENTION_CONFIRMED: undefined }, () => {
    assert.equal(llmConfig().ready, false, "sem confirmar a retenção, não liga");
  });
  withEnv({ AI_PROVIDER: "grok", GROK_API_KEY: "k", GROK_MODEL: "grok-4.3-latest", GROK_RETENTION_CONFIRMED: "true", JUDITE_TOOL_MODE: undefined }, () => {
    const c = llmConfig();
    assert.equal(c.ready, true);
    assert.equal(c.url, "https://api.x.ai/v1/responses");
    assert.deepEqual(routeFor("Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.", c), { model: "grok-4.3-latest", mode: "native", rota: "aberta" });
    assert.deepEqual(routeFor("O que falta pagar?", c), { model: "grok-4.3-latest", mode: "json", rota: "padrao" });
  });
});
