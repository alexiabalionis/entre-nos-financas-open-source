// Protocolo de saída do modelo no laço da Judite (Fase 7.5). Cada resposta do
// modelo é uma de quatro coisas, e o laço trata cada uma de um jeito:
//  - tool_call: pedido de ferramenta válido → executa;
//  - final: {text, action} → valida evidências e números antes de aceitar;
//  - invalid_tool: pediu ferramenta com argumento errado → volta o erro a ele;
//  - invalid_reply: não é JSON ou não tem text → nova tentativa limitada.
import { toolCall, type ToolCall } from "./judite-tools-schema.ts";
import { hypothesesSchema, type Hypothesis } from "../domain/hypothesis-check.ts";

export type Reply =
  | { kind: "tool_call"; call: ToolCall }
  | { kind: "final"; text: string; action: unknown; contas?: string; hipoteses?: Hypothesis[]; hipotesesErro?: string }
  | { kind: "invalid_tool"; name: string; error: string }
  | { kind: "invalid_reply"; error: string };

/** Limite do campo `contas` (o detalhe numérico de "Ver as contas"). */
export const MAX_CONTAS = 2000;

/** Tentativas extras por pergunta para erros de formato (invalid_reply). */
export const MAX_PROTOCOL_RETRIES = 2;

export const PROTOCOL_FAILURE =
  "Não consegui montar a resposta agora. Tente perguntar de novo, se puder de outro jeito.";

/** Texto fixo quando a resposta vira prévia de gravação: o modelo não fala por ela. */
export const ACTION_PREVIEW_TEXT =
  "Preparei a alteração abaixo. Confira os dados e toque em Confirmar para salvar para vocês dois.";

export function classifyReply(raw: string): Reply {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid_reply", error: "A resposta não é um JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { kind: "invalid_reply", error: "A resposta precisa ser um objeto JSON." };
  const obj = value as { tool?: unknown; action?: unknown; text?: unknown; hipoteses?: unknown; contas?: unknown };
  // Tolerância: o modelo às vezes aninha o pedido em action ({"action":{"tool":…}}).
  const nested = obj.action && typeof obj.action === "object" ? (obj.action as { tool?: unknown }).tool : undefined;
  const tool = obj.tool ?? nested;
  if (tool !== undefined && tool !== null) {
    const parsed = toolCall.safeParse({ tool });
    if (parsed.success) return { kind: "tool_call", call: parsed.data.tool };
    const name = typeof (tool as { name?: unknown }).name === "string" ? (tool as { name: string }).name : "?";
    const error = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.filter((p) => p !== "tool").join(".") || "tool"}: ${i.message}`)
      .join("; ");
    return { kind: "invalid_tool", name, error };
  }
  if (typeof obj.text !== "string" || !obj.text.trim())
    return { kind: "invalid_reply", error: 'Faltou o campo "text" com a resposta.' };
  const action = nested !== undefined ? null : (obj.action ?? null);
  // hipoteses: contrato interno do diagnóstico (nunca vai para a pessoa nem para a action).
  const text = obj.text.trim().slice(0, 6000);
  const contas = typeof obj.contas === "string" && obj.contas.trim() ? { contas: obj.contas.trim().slice(0, MAX_CONTAS) } : {};
  if (obj.hipoteses === undefined || obj.hipoteses === null) return { kind: "final", text, action, ...contas };
  const h = hypothesesSchema.safeParse(obj.hipoteses);
  return h.success
    ? { kind: "final", text, action, ...contas, hipoteses: h.data }
    : { kind: "final", text, action, ...contas, hipotesesErro: h.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
