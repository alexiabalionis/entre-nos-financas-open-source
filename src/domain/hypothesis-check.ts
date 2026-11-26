// Hipóteses investigadas (puro): o contrato leve que a Judite devolve junto da
// resposta final de um diagnóstico, fora do texto e fora da action. O modelo
// formula; aqui só se confere a RELAÇÃO entre o que ele diz e o que as
// ferramentas devolveram nesta pergunta (refs pN, iN, sN). Não lê o texto.
import { z } from "zod";

const refId = z.string().regex(/^[pis]\d+$/);
// O modelo segue a convenção do resto do prompt e manda null no que não tem: null vale como ausente.
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => v ?? undefined);
const STATUSES = ["observacao", "confirmada", "nao_sustentada", "evidencia_insuficiente"] as const;
const BENEFITS = ["custo", "caixa", "visibilidade", "menos_decisoes", "protecao_futura"] as const;
export const hypothesisSchema = z
  .object({
    hipotese: z.string().trim().min(1).max(300),
    status: z.enum(STATUSES),
    evidencias: z.array(refId).max(8).nullish().transform((v) => v ?? []),
    contraevidencias: z.array(refId).max(8).nullish().transform((v) => v ?? []),
    mudanca: opt(z.string().trim().max(300)),
    simulacao: opt(refId),
    beneficio: opt(z.enum(BENEFITS)),
    esforco_recorrente: opt(z.enum(["nenhum", "baixo", "medio", "alto"])),
  })
  .strict();
export const hypothesesSchema = z.array(hypothesisSchema).max(6);
type Parsed = z.output<typeof hypothesisSchema>;
type Optional = "mudanca" | "simulacao" | "beneficio" | "esforco_recorrente";
export type Hypothesis = Omit<Parsed, Optional> & { [K in Optional]?: Parsed[K] };

/** O que existe nesta pergunta: refs de padroes e investigar_gastos, e de cada simulação o tipo de resultado. */
export type RefIndex = { patterns: ReadonlySet<string>; simulations: ReadonlyMap<string, string> };

export const HYPOTHESIS_RULES = {
  // Concluir (confirmar ou derrubar) pede investigação ou simulação, não só um destaque de padroes.
  concluir: (h: Hypothesis) => [...h.evidencias, ...h.contraevidencias].some((r) => r.startsWith("i") || r.startsWith("s")),
  // Benefício "custo" só com uma simulação cujo resultado é economia (calculada ou hipotética).
  custo: (kind: string | undefined) => !!kind?.startsWith("economia_"),
} as const;

/**
 * O que checkHypotheses aceita nesta pergunta, dito antes da resposta final
 * (contexto de finalização): os mesmos predicados, aplicados às refs que existem.
 */
export function hypothesisAllowances(refs: RefIndex) {
  const all = [...refs.patterns, ...refs.simulations.keys()];
  return {
    status_validos: STATUSES,
    beneficios_validos: BENEFITS,
    refs_existentes: all,
    concluir_com: all.filter((r) => r.startsWith("i") || r.startsWith("s")),
    custo_com_simulacao: [...refs.simulations].filter(([, kind]) => HYPOTHESIS_RULES.custo(kind)).map(([r]) => r),
    regras: [
      "evidencias, contraevidencias e simulacao só com refs_existentes",
      'confirmada ou nao_sustentada: pelo menos uma ref de concluir_com; só com pN, use "observacao" ou "evidencia_insuficiente"',
      "observacao: pelo menos uma ref em evidencias",
      'beneficio "custo": só com simulacao em custo_com_simulacao; sem isso, use outro benefício ou deixe beneficio de fora (hipótese derrubada não precisa de benefício)',
      "simulacao: só refs sN",
    ],
  };
}

/** Problemas de cada hipótese; lista vazia = contrato coerente com as ferramentas desta pergunta. */
export function checkHypotheses(list: readonly Hypothesis[], refs: RefIndex): string[] {
  const out: string[] = [];
  const exists = (r: string) => (r.startsWith("s") ? refs.simulations.has(r) : refs.patterns.has(r));
  list.forEach((h, k) => {
    const name = `hipótese ${k + 1} ("${h.hipotese.slice(0, 60)}")`;
    for (const r of [...h.evidencias, ...h.contraevidencias, ...(h.simulacao ? [h.simulacao] : [])])
      if (!exists(r)) out.push(`${name}: ${r} não veio de nenhuma ferramenta nesta pergunta`);
    if ((h.status === "confirmada" || h.status === "nao_sustentada") && !HYPOTHESIS_RULES.concluir(h))
      out.push(`${name}: "${h.status}" precisa de investigar_gastos (iN) ou simular_mudanca (sN); só com padroes é "observacao" ou "evidencia_insuficiente"`);
    if (h.status === "observacao" && !h.evidencias.length) out.push(`${name}: observação sem a ref que a sustenta`);
    if (h.beneficio === "custo") {
      const kind = h.simulacao ? refs.simulations.get(h.simulacao) : undefined;
      if (!HYPOTHESIS_RULES.custo(kind)) out.push(`${name}: benefício "custo" precisa de uma simulação de economia (simular_mudanca) em simulacao`);
    }
    if (h.simulacao && !h.simulacao.startsWith("s")) out.push(`${name}: simulacao precisa ser uma ref sN de simular_mudanca`);
  });
  return out;
}
