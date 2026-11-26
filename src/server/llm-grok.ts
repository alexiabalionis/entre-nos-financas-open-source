// xAI (Grok) pela Responses API (POST /v1/responses), como a xAI recomenda:
// https://docs.x.ai/developers/model-capabilities/text/best-practices
//  - store: false e o histórico montado aqui, com o raciocínio cifrado
//    (reasoning.encrypted_content) devolvido sem mudança a cada ida;
//  - esforço explícito, temperature 0.7 e top_p 0.95;
//  - prompt_cache_key igual em todas as idas da pergunta (o cache fica no mesmo servidor).
// A conversa do laço continua no formato de sempre (ChatMessage); só a tradução mora aqui.
import { createHash } from "node:crypto";
import type { ChatMessage, ChatResult, NativeTool, NativeToolCall } from "./llm.ts";
import { parseModel } from "./llm-profiles.ts";

type Payload = {
  model: string;
  instructions: string;
  input: string;
  inputTail?: string;
  json?: boolean;
  max_output_tokens?: number;
  tools?: NativeTool[];
  toolChoice?: "auto" | "none";
  conversation?: ChatMessage[];
};
type Item = Record<string, unknown>;

/** Entrada da pergunta: as duas partes num JSON só, como no Chat Completions sem cache explícito. */
function joined(p: Payload): string {
  return p.inputTail ? JSON.stringify({ ...JSON.parse(p.input), ...JSON.parse(p.inputTail) }) : p.input;
}

/** A conversa do laço em itens da Responses API; o assistente leva de volta os itens crus (raciocínio incluído). */
function items(conversation: readonly ChatMessage[]): Item[] {
  return conversation.flatMap((m): Item[] => {
    if (m.role === "user") return [{ role: "user", content: m.content }];
    if (m.role === "tool") return [{ type: "function_call_output", call_id: m.tool_call_id, output: m.content }];
    if (m.raw?.length) return m.raw as Item[];
    return [
      ...(m.content ? [{ role: "assistant", content: m.content }] : []),
      ...(m.tool_calls ?? []).map((t) => ({ type: "function_call", call_id: t.id, name: t.function.name, arguments: t.function.arguments })),
    ];
  });
}

export function grokPayload(p: Payload, limit: number) {
  const spec = parseModel(p.model);
  return {
    model: spec.id,
    input: [{ role: "system", content: p.instructions }, { role: "user", content: joined(p) }, ...items(p.conversation ?? [])],
    store: false,
    include: ["reasoning.encrypted_content"],
    reasoning: { effort: spec.effort ?? process.env.GROK_REASONING_EFFORT ?? "low" },
    temperature: 0.7,
    top_p: 0.95,
    // Só o texto visível conta aqui (o raciocínio não).
    max_output_tokens: limit,
    // Chave só das instruções fixas: toda pergunta cai no mesmo servidor e o começo igual (~7 mil tokens) vem do cache.
    prompt_cache_key: createHash("sha256").update(p.instructions).digest("hex").slice(0, 32),
    ...(p.tools?.length
      ? { tools: p.tools.map((t) => ({ type: "function", ...t.function })), tool_choice: p.toolChoice ?? "auto", parallel_tool_calls: true }
      : p.json
        ? { text: { format: { type: "json_object" } } }
        : {}),
  };
}

export type GrokBody = {
  status?: string;
  output?: (Item & { type: string })[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};

/** Resposta da Responses API → o mesmo resultado do Chat Completions, com os itens crus para a próxima ida. */
export function parseGrok(body: GrokBody): ChatResult {
  const output = body.output ?? [];
  const toolCalls: NativeToolCall[] = output
    .filter((o) => o.type === "function_call")
    .map((o) => ({ id: String(o.call_id ?? o.id), type: "function", function: { name: String(o.name), arguments: String(o.arguments ?? "{}") } }));
  const text = output
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content ?? []) as { type: string; text?: string }[])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  if (toolCalls.length) return { content: text, toolCalls, raw: output };
  if (body.status !== "completed" || !text) throw new Error("Incomplete response");
  return { content: text.slice(0, 6000), toolCalls: [], raw: output };
}
