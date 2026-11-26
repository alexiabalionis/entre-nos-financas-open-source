// Perfil de cada modelo do DashScope (SPEC-JUDITE-INVESTIGACAO parte 6): como
// pedir pensamento, que amostragem o fabricante recomenda e se há cache
// explícito. Fontes (22/11/2026):
//  - qwen4-max: https://help.aliyun.com/en/model-studio/qwen4-max (enable_thinking padrão true,
//    reasoning_effort low|high|xhigh, preserve_thinking; padrões 1.0/0.95/0.0 pensando e 0.7/0.8/1.5 sem pensar)
//  - qwen3.8-flash e qwen3.8-27b: cartões do modelo (pensamento ligado por padrão; mesmas amostragens;
//    27b com reasoning_effort low|medium|xhigh, padrão xhigh)
//  - cache explícito: https://www.alibabacloud.com/help/en/model-studio/context-cache (lista de modelos)
// Sem variável de ambiente nada muda: o pedido sai como antes.

export type Effort = "low" | "medium" | "high" | "xhigh";
type Sampling = { temperature: number; top_p: number; top_k?: number; presence_penalty: number };
type Profile = { efforts: readonly Effort[]; thinking: Sampling; instruct: Sampling; slow: boolean };

const CARD_THINKING: Sampling = { temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 0 };
const CARD_INSTRUCT: Sampling = { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };
const PROFILES: { match: RegExp; profile: Profile }[] = [
  { match: /^qwen4-max(-|$)/, profile: { efforts: ["low", "high", "xhigh"], thinking: CARD_THINKING, instruct: CARD_INSTRUCT, slow: true } },
  { match: /^qwen3\.8-flash(-|$)/, profile: { efforts: [], thinking: CARD_THINKING, instruct: CARD_INSTRUCT, slow: false } },
  // Denso de 27B: mais lento por token que o flash (MoE com 6B ativos); recebe o tempo dos modelos grandes.
  { match: /^qwen3\.8-27b(-|$)/, profile: { efforts: ["low", "medium", "xhigh"], thinking: CARD_THINKING, instruct: CARD_INSTRUCT, slow: true } },
  // Grok (xAI) raciocina sempre; a amostragem é fixada no payload (0.7/0.95), não aqui.
  { match: /^grok-/, profile: { efforts: ["low", "medium", "high"], thinking: { temperature: 0.7, top_p: 0.95, presence_penalty: 0 }, instruct: { temperature: 0.7, top_p: 0.95, presence_penalty: 0 }, slow: true } },
];
export const profileOf = (id: string): Profile | null => PROFILES.find((p) => p.match.test(id))?.profile ?? null;

// "modelo:thinking" (pensamento com teto de 4000, como sempre) ou "modelo:thinking-low" (com reasoning_effort).
const SPEC = /:thinking(?:-(low|medium|high|xhigh))?$/;
export function parseModel(spec: string): { id: string; thinking: boolean; effort: Effort | null } {
  const m = SPEC.exec(spec);
  return { id: spec.replace(SPEC, ""), thinking: !!m, effort: (m?.[1] as Effort | undefined) ?? null };
}

/** Esforço aceito pelo modelo: o pedido, ou o mais próximo que ele conhece (medium vira high no qwen4-max, como a Alibaba mapeia). */
export function effortFor(id: string, effort: Effort): Effort {
  const known = profileOf(id)?.efforts ?? [];
  if (!known.length || known.includes(effort)) return effort;
  const order: Effort[] = ["low", "medium", "high", "xhigh"];
  return known.find((e) => order.indexOf(e) >= order.indexOf(effort)) ?? known[known.length - 1]!;
}

/**
 * Amostragem enviada (JUDITE_SAMPLING): sem a variável, nenhuma (padrão do provedor).
 * "cartao" = a recomendada pelo fabricante para o modo; "preciso" = experimento só sem pensar
 * (temperatura 0,3 e sem presence_penalty; pensando, vale o cartão, porque temperatura baixa
 * atrapalha modelo que pensa).
 */
export function samplingFor(id: string, thinking: boolean, requested?: string | null): Sampling | null {
  const mode = requested ?? process.env.JUDITE_SAMPLING;
  const p = profileOf(id);
  if (!p || (mode !== "cartao" && mode !== "preciso")) return null;
  if (thinking) return p.thinking;
  return mode === "preciso" ? { temperature: 0.3, top_p: 0.8, top_k: 20, presence_penalty: 0 } : p.instruct;
}

// Cache explícito desde antes; a lista da Alibaba (internacional) também tem qwen3.8-flash e
// qwen3.8-27b, ligados só com JUDITE_EXPLICIT_CACHE_ALL=1 (o pedido muda de forma: duas partes).
const EXPLICIT_CACHE = /^(qwen4-max|qwen3\.8-max|qwen3\.7-plus|qwen3\.7-max|qwen3\.6-flash)(-|$)/;
const EXPLICIT_CACHE_MORE = /^(qwen3\.8-flash|qwen3\.7-flash|qwen3\.8-27b|qwen3\.8-2\.4t-a95b)(-|$)/;
export const explicitCache = (id: string) => EXPLICIT_CACHE.test(id) || (process.env.JUDITE_EXPLICIT_CACHE_ALL === "1" && EXPLICIT_CACHE_MORE.test(id));
