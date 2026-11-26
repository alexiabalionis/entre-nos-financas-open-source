import { sanitizePayloadText } from "../domain/prompt-privacy.ts";
import { grokPayload, parseGrok, type GrokBody } from "./llm-grok.ts";
import { effortFor, explicitCache, parseModel, profileOf, samplingFor } from "./llm-profiles.ts";

export function llmConfig() {
  const provider = process.env.AI_PROVIDER;
  // xAI (Grok): Responses API (llm-grok.ts), com o raciocínio cifrado devolvido a cada ida.
  // Retenção confirmada como nos outros provedores.
  if (provider === "grok" || provider === "xai") {
    const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    return {
      provider: "xAI",
      model: process.env.GROK_MODEL || "grok-4.3-latest",
      key,
      ready: !!key && process.env.GROK_RETENTION_CONFIRMED === "true",
      url: "https://api.x.ai/v1/responses",
      chat: "grok" as const,
    };
  }
  if (provider === "groq")
    return {
      provider: "Groq",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      key: process.env.GROQ_API_KEY,
      ready:
        !!process.env.GROQ_API_KEY &&
        process.env.GROQ_ZDR_CONFIRMED === "true",
      url: "https://api.groq.com/openai/v1/chat/completions",
      chat: "groq" as const,
    };
  if (provider === "dashscope")
    return {
      provider: "DashScope",
      model: process.env.DASHSCOPE_MODEL || "qwen3.8-flash",
      key: process.env.DASHSCOPE_API_KEY,
      ready:
        !!process.env.DASHSCOPE_API_KEY &&
        !!process.env.DASHSCOPE_MODEL &&
        process.env.DASHSCOPE_RETENTION_CONFIRMED === "true",
      url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      chat: "dashscope" as const,
    };
  return {
    provider: "OpenAI",
    model: process.env.OPENAI_MODEL || "",
    key: process.env.OPENAI_API_KEY,
    ready:
      provider === "openai" &&
      !!process.env.OPENAI_API_KEY &&
      !!process.env.OPENAI_MODEL,
    url: "https://api.openai.com/v1/responses",
    chat: null,
  };
}
// Cache explícito: lista e perfis em llm-profiles.ts.

/** Mensagem da conversa de ferramentas nativas (Function Calling), depois do system e da entrada. */
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: NativeToolCall[]; reasoning_content?: string; raw?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type NativeToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
/** Definição de ferramenta no formato do provedor (OpenAI-compatible). */
export type NativeTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

type LlmPayload = {
  model: string;
  instructions: string;
  /** Parte estável da entrada (JSON): igual em todas as rodadas do laço. */
  input: string;
  /** Parte que muda a cada rodada (JSON), depois da estável. */
  inputTail?: string;
  json?: boolean;
  max_output_tokens?: number;
  /** OpenAI Responses: false = não guardar a conversa no provedor. */
  store?: boolean;
  /** Medidor da pergunta (não vai ao provedor): idas, tokens, cache e tempo. */
  meter?: LlmMeter;
  /** Function Calling nativo: as ferramentas desta rodada e a conversa até aqui. */
  tools?: NativeTool[];
  /** "none" quando o orçamento de ferramentas acabou (as definições continuam, a conversa já tem chamadas). */
  toolChoice?: "auto" | "none";
  conversation?: ChatMessage[];
  /** Amostragem pedida para esta pergunta (rota aberta: "cartao"); sem o campo, vale JUDITE_SAMPLING. */
  sampling?: "cartao" | "preciso";
  /** Marca de cache na conversa de ferramentas (rota aberta); sem o campo, vale JUDITE_CACHE_CONVO. */
  cacheConversation?: boolean;
};

export type LlmMeter = {
  calls: number;
  tokens: number;
  input: number;
  output: number;
  /** Parte de `output` gasta pensando (modelos com `:thinking`). */
  reasoning: number;
  cached: number;
  ms: number;
  model: string;
};
export const newMeter = (): LlmMeter => ({
  calls: 0,
  tokens: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cached: 0,
  ms: 0,
  model: "",
});

// "qwen3.7-plus:thinking" liga o pensamento só para aquele modelo da lista;
// "qwen4-max:thinking-low" liga com reasoning_effort (perfil em llm-profiles.ts).
const THINKING = /:thinking(?:-(?:low|medium|high|xhigh))?$/;
const THINKING_BUDGET = 4000;
/** Com reasoning_effort o provedor decide quanto pensar: folga para o pensamento caber junto da resposta. */
const EFFORT_ROOM = 16000;
export const modelId = (model: string) => parseModel(model).id;

/** Sem cache explícito, as duas partes viram um JSON só (o formato de sempre). */
function joinedInput(p: LlmPayload): string {
  if (!p.inputTail) return p.input;
  return JSON.stringify({ ...JSON.parse(p.input), ...JSON.parse(p.inputTail) });
}

/** Marca de cache na última mensagem com texto da conversa (JUDITE_CACHE_CONVO=1): o histórico que cresce também é reaproveitado. */
function markConversation(conversation: ChatMessage[]): unknown[] {
  const at = conversation.findLastIndex((m) => m.role !== "assistant" && m.content);
  return conversation.map((m, i) => (i === at ? { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] } : m));
}

export function chatCompletionsPayload(payload: LlmPayload, chat: "groq" | "dashscope") {
  // O chat pede 1800; as demais perguntas ficam no piso de 1200.
  const limit = Math.max(1200, payload.max_output_tokens ?? 0);
  const spec = parseModel(payload.model);
  const thinking = chat === "dashscope" && spec.thinking;
  const model = spec.id;
  const cached = chat === "dashscope" && explicitCache(model);
  const mark = { cache_control: { type: "ephemeral" } };
  const base = {
    model,
    messages: cached
      ? [
          // Instruções fixas primeiro, depois os fatos da pergunta, e só então o
          // que muda a cada rodada: cada marcador guarda o começo até ele.
          { role: "system", content: [{ type: "text", text: payload.instructions, ...mark }] },
          {
            role: "user",
            content: [
              { type: "text", text: payload.input, ...mark },
              ...(payload.inputTail ? [{ type: "text", text: payload.inputTail }] : []),
            ],
          },
        ]
      : [
          { role: "system", content: payload.instructions },
          { role: "user", content: joinedInput(payload) },
        ],
    // Com tools o JSON da resposta final fica só no prompt: json_object empurra o modelo a responder no texto
    // em vez de chamar a função (qwen4-max, 22/11/2026). Sem tools, nada muda.
    ...(payload.json && !thinking && !payload.tools?.length ? { response_format: { type: "json_object" } } : {}),
    ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.toolChoice ?? "auto", parallel_tool_calls: true } : {}),
  };
  // A conversa de ferramentas vem depois da entrada (o começo continua igual: o cache vale).
  if (payload.conversation?.length)
    base.messages = [...base.messages, ...(cached && (payload.cacheConversation ?? process.env.JUDITE_CACHE_CONVO === "1") ? markConversation(payload.conversation) : payload.conversation)] as typeof base.messages;
  // Groq's gpt-oss models need reasoning_effort/include_reasoning; DashScope's
  // Qwen hybrid-thinking models use enable_thinking and plain max_tokens instead.
  // Pensamento desligado por padrão: no DashScope ele conta como saída (gasta a
  // cota) e não aceita o modo JSON. Com `:thinking`, o JSON fica só no prompt
  // (o laço já trata resposta fora do formato) e o pensamento tem teto próprio.
  if (chat === "groq")
    return {
      ...base,
      max_completion_tokens: limit,
      reasoning_effort: "low",
      include_reasoning: false,
    };
  // Grok raciocina sempre: vai pela Responses API (llm-grok.ts), não por aqui.
  const sampling = samplingFor(model, thinking, payload.sampling) ?? {};
  if (!thinking) return { ...base, ...sampling, max_tokens: limit, enable_thinking: false };
  // Pensando em várias idas: o raciocínio volta nas mensagens do assistente (preserve_thinking).
  if (spec.effort)
    return { ...base, ...sampling, max_tokens: limit + EFFORT_ROOM, enable_thinking: true, reasoning_effort: effortFor(model, spec.effort), preserve_thinking: true };
  return { ...base, ...sampling, max_tokens: limit + THINKING_BUDGET, enable_thinking: true, thinking_budget: THINKING_BUDGET };
}
/** Modelo grande (max, ou o perfil diz que é lento): resposta mais lenta por ida; recebe mais tempo por chamada e por pergunta. */
export const slowModel = (model: string) =>
  model.split(",").some((m) => /-max(-|:|$)/.test(m.trim()) || !!profileOf(parseModel(m.trim()).id)?.slow);
/** Algum modelo da lista pensa: o laço dá o orçamento longo. */
export const thinkingModel = (model: string) => model.split(",").some((m) => parseModel(m.trim()).thinking);
const callTimeout = (model: string) => (THINKING.test(model) || /^grok-/.test(model) ? 120000 : slowModel(model) ? 60000 : 20000);

export type ChatResult = { content: string; toolCalls: NativeToolCall[]; reasoning?: string; raw?: unknown[] };

/** Resposta de texto (o protocolo JSON de sempre): sem Function Calling. */
export async function requestLlm(payload: LlmPayload): Promise<string> {
  return (await requestLlmChat({ ...payload, tools: undefined, conversation: undefined })).content;
}

/**
 * Pedido com Function Calling nativo quando `tools` vem: a resposta pode trazer
 * tool_calls (com o id do provedor) em vez de texto. Sem `tools`, é o mesmo
 * pedido de requestLlm.
 */
export async function requestLlmChat(payload: LlmPayload): Promise<ChatResult> {
  // Ponto único de saída para o provedor: textos livres passam pela
  // sanitização central (prompt-privacy.ts). O banco não muda.
  payload = {
    ...payload,
    input: sanitizePayloadText(payload.input),
    ...(payload.inputTail ? { inputTail: sanitizePayloadText(payload.inputTail) } : {}),
    ...(payload.conversation
      ? { conversation: payload.conversation.map((m) => (m.role === "assistant" ? m : { ...m, content: sanitizePayloadText(m.content) })) }
      : {}),
  };
  // `model` pode ser uma lista ("qwen4-max,qwen3.5-122b-a10b"): quando a cota
  // grátis de um acaba (403 AllocationQuota) ou ele limita (429), tenta o
  // próximo. Modelo esgotado fica marcado por 1 hora para não gastar uma
  // chamada a cada pergunta.
  const models = payload.model.split(",").map((m) => m.trim()).filter(Boolean);
  const usable = models.filter((m) => (exhausted.get(m) ?? 0) < Date.now());
  let last: Error = new Error("PROVIDER_UNAVAILABLE");
  for (const model of usable.length ? usable : models) {
    try {
      return await requestModel({ ...payload, model });
    } catch (error) {
      last = error as Error;
      if (!["PROVIDER_RATE_LIMIT", "PROVIDER_QUOTA", "PROVIDER_INCOMPATIBLE"].includes(last.message)) throw last;
      if (last.message === "PROVIDER_QUOTA") exhausted.set(model, Date.now() + 60 * 60 * 1000);
      if (last.message === "PROVIDER_INCOMPATIBLE") exhausted.set(model, Date.now() + 24 * 60 * 60 * 1000);
    }
  }
  throw last.message === "PROVIDER_QUOTA"
    ? new Error("PROVIDER_RATE_LIMIT")
    : last.message === "PROVIDER_INCOMPATIBLE"
      ? new Error("PROVIDER_UNAVAILABLE")
      : last;
}
const exhausted = new Map<string, number>();

/** O modelo que respondeu por último (para a fonte da resposta). */
export function modelLabel(list: string): string {
  const models = list.split(",").map((m) => m.trim()).filter(Boolean);
  return models.find((m) => (exhausted.get(m) ?? 0) < Date.now()) ?? models[0] ?? "";
}

async function requestModel(payload: LlmPayload): Promise<ChatResult> {
  const config = llmConfig();
  if (!config.ready || !config.key) throw new Error("Provider not configured");
  // OpenAI Responses: sem `json`/`inputTail` (só o chat-completions os usa).
  const responsesPayload = {
    model: payload.model,
    instructions: payload.instructions,
    input: joinedInput(payload),
    store: payload.store ?? false,
    ...(payload.max_output_tokens ? { max_output_tokens: payload.max_output_tokens } : {}),
  };
  const started = Date.now();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify(
      config.chat === "grok"
        ? grokPayload(payload, Math.max(1200, payload.max_output_tokens ?? 0))
        : config.chat
          ? chatCompletionsPayload(payload, config.chat)
          : responsesPayload,
    ),
    signal: AbortSignal.timeout(callTimeout(payload.model)),
    redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("PROVIDER_RATE_LIMIT");
    const detail = response.status === 403 || response.status === 400 ? await response.text().catch(() => "") : "";
    // DashScope "Free Only": cota grátis do modelo acabou (403 AllocationQuota.FreeTierOnly).
    if (response.status === 403 && /AllocationQuota|FreeTierOnly|quota/i.test(detail)) throw new Error("PROVIDER_QUOTA");
    // Modelo que não desliga o pensamento (ex.: glm-5.3) ou não aceita modo JSON
    // sem pensar: não serve para este pedido; passa para o próximo da lista.
    if (response.status === 400 && /enable_thinking|json mode|response_format|stream call/i.test(detail))
      throw new Error("PROVIDER_INCOMPATIBLE");
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  const body = (await response.json()) as {
    status?: string;
    choices?: { finish_reason: string; message?: { content?: string | null; tool_calls?: NativeToolCall[] | null; reasoning_content?: string | null } }[];
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: {
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
  };
  if (payload.meter) {
    payload.meter.calls++;
    payload.meter.ms += Date.now() - started;
    payload.meter.tokens += body.usage?.total_tokens ?? 0;
    // Chat Completions usa prompt/completion; Responses usa input/output.
    payload.meter.input += body.usage?.prompt_tokens ?? body.usage?.input_tokens ?? 0;
    payload.meter.output += body.usage?.completion_tokens ?? body.usage?.output_tokens ?? 0;
    payload.meter.cached += body.usage?.prompt_tokens_details?.cached_tokens ?? body.usage?.input_tokens_details?.cached_tokens ?? 0;
    payload.meter.reasoning += body.usage?.completion_tokens_details?.reasoning_tokens ?? body.usage?.output_tokens_details?.reasoning_tokens ?? 0;
    payload.meter.model = payload.model;
  }
  if (config.chat === "grok") return parseGrok(body as GrokBody);
  if (config.chat) {
    const choice = body.choices?.[0];
    const calls = payload.tools?.length ? (choice?.message?.tool_calls ?? []) : [];
    const reasoning = choice?.message?.reasoning_content || undefined;
    if (calls.length) return { content: (choice?.message?.content ?? "").trim(), toolCalls: calls, ...(reasoning ? { reasoning } : {}) };
    if (choice?.finish_reason !== "stop" || !choice.message?.content?.trim())
      throw new Error("Incomplete response");
    return { content: choice.message.content.trim().slice(0, 6000), toolCalls: [] };
  }
  const text = body.output
    ?.filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  if (body.status !== "completed" || !text)
    throw new Error("Incomplete response");
  return { content: text.slice(0, 6000), toolCalls: [] };
}
