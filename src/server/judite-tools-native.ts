// Function Calling nativo (experimental, SPEC-JUDITE-INVESTIGACAO parte 3).
// Uma definição canônica só: as ferramentas nativas saem do MESMO schema zod
// (`toolCall`) que valida o protocolo JSON, e a descrição de cada uma é a linha
// dela em TOOLS_PROMPT. Os argumentos que o modelo manda passam pela mesma
// validação do protocolo JSON. Só ferramentas de leitura: as actions de
// escrita continuam na resposta final {text, action} e na confirmação.
import { z } from "zod";
import type { NativeTool, NativeToolCall } from "./llm.ts";
import { FINAL_CONTAS, MAX_TOOL_CALLS, toolCall, TOOLS_PROMPT, toolsPrompt, type ToolCall } from "./judite-tools-schema.ts";
import { classicFormat } from "./judite-numbers.ts";
import { diagnosticIntent, quickIntent } from "./judite-evidence.ts";

/** Modo do laço: "json" (o protocolo de sempre) ou "native" (Function Calling). */
export type ToolMode = "json" | "native";
export function toolMode(): ToolMode {
  return process.env.JUDITE_TOOL_MODE === "native" ? "native" : "json";
}

/**
 * Roteamento por tipo de pergunta (decisão de 22/11/2026), só no DashScope:
 * diagnóstico aberto vai para o modelo de investigação (DASHSCOPE_OPEN_MODEL,
 * padrão qwen4-max) com Function Calling nativo; o resto fica no
 * DASHSCOPE_MODEL com o modo de JUDITE_TOOL_MODE (padrão json).
 * DASHSCOPE_OPEN_MODEL=off desliga o roteamento.
 */
export function routeFor(
  question: string,
  provider: { chat: string | null; model: string },
  history?: readonly { role: string; text: string }[],
): { model: string; mode: ToolMode; rota: "aberta" | "padrao"; maxTools?: number } {
  const diagnostic = diagnosticIntent(question, history);
  // Rota aberta solta (Fase 1): toda pergunta, menos as curtas. JUDITE_OPEN_ROUTE=diagnostic volta ao detector de diagnóstico.
  const open = process.env.JUDITE_OPEN_ROUTE === "diagnostic" ? diagnostic : diagnostic || !quickIntent(question);
  // O modelo tem 5 chamadas próprias na rota aberta: no diagnóstico o padroes do prefetch gasta a sexta; fora dele, o teto é 5.
  const own = diagnostic ? {} : { maxTools: MAX_TOOL_CALLS - 1 };
  // xAI: a rota aberta usa o mesmo modelo com o tratamento da rota aberta (Function Calling nativo,
  // contexto de finalização, otimizações); o resto, JUDITE_TOOL_MODE (json por padrão).
  if (provider.chat === "grok")
    return open && process.env.GROK_OPEN_ROUTE !== "off"
      ? { model: provider.model, mode: "native", rota: "aberta", ...own }
      : { model: provider.model, mode: toolMode(), rota: "padrao" };
  if (provider.chat !== "dashscope") return { model: provider.model, mode: "json", rota: "padrao" };
  const openModel = process.env.DASHSCOPE_OPEN_MODEL ?? "qwen4-max";
  if (openModel !== "off" && openModel.trim() && open) {
    // Experimento de latência: teto de ferramentas só desta rota, contando o prefetch (sem a variável, o de sempre).
    const limit = Number(process.env.JUDITE_OPEN_MAX_TOOLS);
    return { model: openModel.trim(), mode: "native", rota: "aberta", ...own, ...(Number.isInteger(limit) && limit >= 1 && limit <= MAX_TOOL_CALLS ? { maxTools: limit } : {}) };
  }
  return { model: provider.model, mode: toolMode(), rota: "padrao" };
}

/** Acrescentado às instruções no modo nativo: o resto do prompt não muda. */
export const NATIVE_NOTE =
  'Neste atendimento, peça ferramentas pela chamada de função nativa (tools), uma ou várias de uma vez quando forem independentes; os resultados voltam como mensagens de ferramenta. Não escreva {"tool":...} no texto. A resposta final continua sendo SOMENTE o JSON {"text":...,"action":...} (e hipoteses, no diagnóstico).';

type Option = { shape: { name: { value: string } } } & z.ZodType;
const options = () => (toolCall.shape.tool as unknown as { options: Option[] }).options;

/** A linha de TOOLS_PROMPT de uma ferramenta, sem o exemplo de chamada: vira a descrição nativa (inteira no prompt enxuto). */
function descriptionOf(name: string, full = false): string {
  const line = TOOLS_PROMPT.split("\n").find((l) => l.startsWith(`- {"tool":{"name":"${name}"`));
  if (!line) return name;
  const at = line.indexOf("}}:");
  const tail = (at >= 0 ? line.slice(at + 3) : line).trim();
  return full ? tail : tail.slice(0, 1000);
}

/**
 * Prompt enxuto (JUDITE_PROMPT=compact, só no modo nativo): a descrição de cada
 * ferramenta vai só nas definições de função, inteira (antes ia duas vezes e a
 * nativa era cortada em 1000 caracteres: investigar_gastos perdia o fim).
 */
export const promptCompact = () => process.env.JUDITE_PROMPT === "compact";

/**
 * Otimizações da rota aberta (decisão de 22/11/2026, SPEC parte 6): ligadas por
 * padrão só no diagnóstico aberto. JUDITE_OPEN_OPT=off desliga todas; cada
 * variável individual com "0" (ou JUDITE_PROMPT=full, JUDITE_SAMPLING=off)
 * desliga só a sua. Nas outras rotas vale só a variável individual ligada.
 */
export type RouteOptions = { compact: boolean; sampling?: "cartao" | "preciso"; cacheConversation: boolean; keepTools: boolean; finalShort: boolean };
export function routeOptions(rota: "aberta" | "padrao", mode: ToolMode): RouteOptions {
  const env = process.env;
  const open = rota === "aberta" && env.JUDITE_OPEN_OPT !== "off";
  const on = (name: string) => env[name] === "1" || (open && env[name] !== "0");
  const sampling = env.JUDITE_SAMPLING === "preciso" || env.JUDITE_SAMPLING === "cartao" ? env.JUDITE_SAMPLING : open && env.JUDITE_SAMPLING !== "off" ? "cartao" : undefined;
  return {
    compact: mode === "native" && (promptCompact() || (open && env.JUDITE_PROMPT !== "full")),
    ...(sampling ? { sampling } : {}),
    cacheConversation: on("JUDITE_CACHE_CONVO"),
    keepTools: mode === "native" && on("JUDITE_FINAL_KEEP_TOOLS"),
    finalShort: on("JUDITE_FINAL_SHORT"),
  };
}

/**
 * TOOLS_PROMPT sem o que as definições nativas já dizem: as linhas de cada
 * ferramenta e a regra do protocolo {"tool":...} (o NATIVE_NOTE diz como pedir).
 * O roteiro por tipo de pergunta sai no diagnóstico: o roteiro antigo de diagnóstico
 * disputava com "Melhorar as finanças" (Parte 2, causa 5). Nas outras perguntas da
 * rota aberta (keepRoteiro) ele fica. O resto (memória, padrões, diagnóstico, dinheiro) fica igual.
 */
export function compactToolsPrompt(keepRoteiro = false): string {
  const lines = toolsPrompt().split("\n");
  return [
    "Ferramentas (só leitura, calculadas pelo aplicativo): as definições de função dizem o que cada uma faz. Use quantas precisar para entender antes de responder; quando tiver o que precisa, responda no formato final. Se precisa de mais dados, peça a ferramenta; não anuncie na resposta que vai buscar." +
      (classicFormat() ? "" : ` Quando tiver o que precisa, ${FINAL_CONTAS}`),
    ...lines.slice(1).filter((l) => !l.startsWith('- {"tool"') && (keepRoteiro || !l.startsWith("Roteiro:"))),
  ].join("\n");
}

const cached = new Map<boolean, NativeTool[]>();
/** As ferramentas no formato do provedor, geradas do schema canônico. */
export function nativeTools(full = false): NativeTool[] {
  const hit = cached.get(full);
  if (hit) return hit;
  const tools = options().map((o) => {
    const name = o.shape.name.value;
    const schema = z.toJSONSchema(o, { io: "input" }) as Record<string, unknown> & {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const rest = { ...schema };
    delete rest.$schema;
    const properties = { ...(rest.properties ?? {}) };
    delete properties.name;
    const required = (rest.required ?? []).filter((r) => r !== "name");
    return {
      type: "function" as const,
      function: {
        name,
        description: descriptionOf(name, full),
        parameters: { ...rest, properties, ...(required.length ? { required } : { required: [] }) },
      },
    };
  });
  cached.set(full, tools);
  return tools;
}

/** Argumentos nativos → a mesma chamada validada do protocolo JSON. */
export function parseNativeCall(call: NativeToolCall): { ok: true; call: ToolCall } | { ok: false; name: string; error: string } {
  const name = call.function?.name ?? "?";
  let args: unknown;
  try {
    args = call.function?.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { ok: false, name, error: "argumentos não são JSON" };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, name, error: "argumentos precisam ser um objeto" };
  const parsed = toolCall.safeParse({ tool: { ...(args as Record<string, unknown>), name } });
  if (parsed.success) return { ok: true, call: parsed.data.tool };
  const error = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.filter((p) => p !== "tool").join(".") || "tool"}: ${i.message}`)
    .join("; ");
  return { ok: false, name, error };
}

/**
 * Resposta fora do protocolo, para diagnóstico SEM dado financeiro: a forma
 * (objeto, lista, texto), o tamanho e o começo com letras e números mascarados.
 */
export function protocolShape(raw: string): { tipo: string; caracteres: number; forma: string } {
  let tipo = "texto";
  try {
    const v = JSON.parse(raw) as unknown;
    tipo = Array.isArray(v) ? "lista" : v === null ? "null" : typeof v === "object" ? "objeto" : typeof v;
  } catch {
    tipo = /^\s*[[{]/.test(raw) ? "json_cortado" : "texto";
  }
  // Mantém as chaves (nome de campo e de ferramenta não é dado da casa) e mascara os valores.
  const forma = raw
    .slice(0, 200)
    .replace(/"((?:[^"\\]|\\.)*)"(\s*:)?/g, (_m, inner: string, colon?: string) => (colon ? `"${inner}":` : `"${"x".repeat(Math.min(inner.length, 8))}"`))
    .replace(/\d/g, "9");
  return { tipo, caracteres: raw.length, forma };
}
