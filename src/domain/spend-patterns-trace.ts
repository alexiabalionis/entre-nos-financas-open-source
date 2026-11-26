// Rastreio de diagnóstico dos padrões (M1, só observação): cada detector conta
// aqui o que avaliou, o que passou, o que caiu e por quê, com as evidências que
// hoje morrem antes do destaque. Sem trace, nenhuma chamada acontece e o
// resultado é o mesmo; com trace, só se acrescenta registro, nunca se decide.
import type { AnalysisId, Item, Recorte } from "./spend-patterns-core.ts";

export const TRACE_FORMAT_VERSION = 1;

// Motivos espelham as verificações reais de cada detector (nada de motivo genérico).
export type RejectReason =
  | "insufficient_months" // metade recente sem meses suficientes para a análise
  | "insufficient_base" // recorte abaixo do volume mínimo
  | "insufficient_subset" // pedaço do padrão abaixo do volume mínimo
  | "below_threshold" // força abaixo do limite (índice, parte, variação, valor)
  | "not_persistent" // não se sustenta nas duas metades
  | "outlier_sensitive" // some sem o mês mais extremo
  | "irregular_interval" // recorrência: intervalos fora de mensal e semanal
  | "already_fixed" // recorrência: o lugar já é conta fixa
  | "no_income" // comprometimento: sem renda média
  | "no_salary_dates"; // ritmo: menos de 2 datas de salário

export type Check = { nome: string; valor: number | string | null; limite: number | string | null; passou: boolean };

export type TraceCandidate = {
  analise: AnalysisId;
  recorte: { tipo: Recorte; chave: string };
  // Eixo ou variante dentro da análise (ex.: parte_do_mes; contas fixas x parcelamentos novos).
  variante: string | null;
  status: "aprovado" | "rejeitado";
  motivo: RejectReason | null;
  // Corte do destaque quando aprovado (mesma string do destaque).
  corte: string | null;
  checks: Check[];
  base: { compras: number; ids: string[] | null };
  corte_ids: string[] | null;
  evidencia: Record<string, unknown> | null;
};

export const idsOf = (items: readonly Item[]): string[] => items.map((i) => i.p.id ?? "");

export class PatternTrace {
  readonly candidates: TraceCandidate[] = [];

  add(c: {
    analise: AnalysisId;
    recorte: { tipo: Recorte; chave: string };
    variante?: string | null;
    motivo: RejectReason | null;
    corte?: string | null;
    checks?: Check[];
    base: readonly Item[];
    cut?: readonly Item[] | null;
    evidencia?: Record<string, unknown> | null;
  }): void {
    // Recorte abaixo do volume mínimo: só a contagem, para o arquivo não virar uma lista de todos os lugares.
    const thin = c.motivo === "insufficient_base";
    this.candidates.push({
      analise: c.analise,
      recorte: { tipo: c.recorte.tipo, chave: c.recorte.chave },
      variante: c.variante ?? null,
      status: c.motivo === null ? "aprovado" : "rejeitado",
      motivo: c.motivo,
      corte: c.corte ?? null,
      checks: c.checks ?? [],
      base: { compras: c.base.length, ids: thin ? null : idsOf(c.base) },
      corte_ids: c.cut ? idsOf(c.cut) : null,
      evidencia: c.evidencia ?? null,
    });
  }
}

export const check = (nome: string, valor: number | string | null, limite: number | string | null, passou: boolean): Check => ({
  nome,
  valor: typeof valor === "number" ? Math.round(valor * 10_000) / 10_000 : valor,
  limite,
  passou,
});

type HighlightLike = {
  analise: AnalysisId;
  recorte: { tipo: Recorte; chave: string };
  corte: string;
  base: { corte_compras: number; corte_cents: bigint };
  em_jogo_cents: bigint;
};

export const findingKey = (h: { analise: string; recorte: { tipo: string; chave: string }; corte: string | null }) =>
  [h.analise, h.recorte.tipo, h.recorte.chave, h.corte ?? ""].join(" | ");
// A mesma chave que dedupHighlights usa para juntar destaques.
const dedupKey = (h: HighlightLike) => [h.analise, h.corte, h.base.corte_compras, h.base.corte_cents].join("\u0000");

export type SelectionEntry = {
  posicao: number;
  chave: string;
  em_jogo_cents: string;
  status: "enviado" | "deduplicated" | "ranking_cutoff";
  absorvido_por: string | null;
  ref: string | null;
};

/** O caminho de cada destaque aprovado: ordem original, deduplicação e corte do limite. */
export function selectionTrace(
  ranked: readonly HighlightLike[],
  deduped: readonly HighlightLike[],
  sent: readonly HighlightLike[],
  refs: readonly string[],
): SelectionEntry[] {
  const kept = new Map(deduped.map((h) => [dedupKey(h), h]));
  return ranked.map((h, i) => {
    const sentAt = sent.indexOf(h);
    const survivor = kept.get(dedupKey(h))!;
    const status = sentAt >= 0 ? "enviado" : survivor !== h ? "deduplicated" : "ranking_cutoff";
    return {
      posicao: i,
      chave: findingKey(h),
      em_jogo_cents: h.em_jogo_cents.toString(),
      status,
      absorvido_por: status === "deduplicated" ? findingKey(survivor) : null,
      ref: sentAt >= 0 ? refs[sentAt]! : null,
    };
  });
}

// Hipótese inicial a testar (não regra): acima disso os dois achados são as mesmas compras.
export const OVERLAP_SAME = 0.8;
/**
 * duplicado: praticamente as mesmas compras (Jaccard alto) e a mesma análise;
 * mesmas_compras: as mesmas compras vistas por análises diferentes (complementares);
 * contido: o menor está quase todo dentro do maior (um específico dentro do agregado);
 * parcial: dividem só uma parte.
 */
export type OverlapRelation = "duplicado" | "mesmas_compras" | "contido" | "parcial";
export type Overlap = {
  a: string;
  b: string;
  comuns: number;
  jaccard: number;
  cobertura: number;
  mesma_analise: boolean;
  relacao: OverlapRelation;
  // Em "contido", a chave do achado menor (o específico).
  especifico: string | null;
};

export function overlapRelation(jaccard: number, cobertura: number, sameAnalysis: boolean): OverlapRelation {
  if (jaccard >= OVERLAP_SAME) return sameAnalysis ? "duplicado" : "mesmas_compras";
  return cobertura >= OVERLAP_SAME ? "contido" : "parcial";
}

/**
 * Sobreposição entre os conjuntos de compras que sustentam cada achado aprovado
 * (Jaccard = comuns / união; cobertura = comuns / menor). Só diagnóstico: nada é
 * removido por aqui. Pares sem compra em comum ficam de fora.
 */
export function overlaps(candidates: readonly TraceCandidate[]): Overlap[] {
  const approved = candidates
    .filter((c) => c.status === "aprovado" && c.corte_ids && c.corte_ids.length > 0)
    .map((c) => ({ key: findingKey(c), analise: c.analise, ids: new Set(c.corte_ids!) }));
  const out: Overlap[] = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i]!;
      const b = approved[j]!;
      let comuns = 0;
      for (const id of a.ids) if (b.ids.has(id)) comuns++;
      if (!comuns) continue;
      const round = (n: number) => Math.round(n * 10_000) / 10_000;
      const jaccard = round(comuns / (a.ids.size + b.ids.size - comuns));
      const cobertura = round(comuns / Math.min(a.ids.size, b.ids.size));
      const relacao = overlapRelation(jaccard, cobertura, a.analise === b.analise);
      out.push({
        a: a.key,
        b: b.key,
        comuns,
        jaccard,
        cobertura,
        mesma_analise: a.analise === b.analise,
        relacao,
        especifico: relacao === "contido" ? (a.ids.size <= b.ids.size ? a.key : b.key) : null,
      });
    }
  }
  return out.sort((x, y) => y.cobertura - x.cobertura || y.jaccard - x.jaccard);
}
