// Padrões de gasto (puro): lista fechada de 9 análises sobre as compras do
// período, três travas contra padrão inventado (volume, força, repetição nas
// duas metades) e as alavancas em dinheiro por mês. Sem banco, sem Date local.
import {
  LIMITS,
  buildContext,
  type Found,
  type Highlight,
  type PatternInput,
  type Purchase,
} from "./spend-patterns-core.ts";
import {
  analyzeCommitment,
  analyzeHiddenRecurrence,
  analyzePaymentMix,
  analyzePlaces,
  analyzeSmallPurchases,
  analyzeTrend,
} from "./spend-patterns-habits.ts";
import { analyzeConcentration, analyzeOutlierDays, analyzeSalaryRhythm } from "./spend-patterns-time.ts";

export { LIMITS, brasiliaOf, timeQuality } from "./spend-patterns-core.ts";
export type {
  AnalysisId,
  EmJogoNatureza,
  Highlight,
  Lever,
  LeverKind,
  PatternInput,
  Payment,
  Purchase,
  PurchaseType,
  Recorte,
  TimeQuality,
} from "./spend-patterns-core.ts";

export type PatternResult = {
  periodo: { de: string; ate: string };
  meses: number;
  compras_analisadas: number;
  // Parte do gasto avulso com hora real; abaixo do mínimo os padrões de hora não rodam.
  cobertura_hora: number;
  // Falso quando não há data de salário: ritmo depois do salário não rodou.
  ciclo_salario: boolean;
  destaques: Highlight[];
  sem_padrao: { avaliadas: number; aprovadas: number };
};

const ORDER = [
  "concentracao_tempo",
  "tendencia",
  "lugares",
  "compras_pequenas",
  "recorrencia_escondida",
  "ritmo_salario",
  "comprometimento",
  "dias_fora_da_curva",
  "forma_pagamento",
] as const;

export function findPatterns(input: PatternInput): PatternResult {
  const ctx = buildContext(input);
  const runs: Found[] =
    ctx.nMonths < 2
      ? []
      : [
          analyzeConcentration(ctx),
          analyzeTrend(ctx),
          analyzePlaces(ctx),
          analyzeSmallPurchases(ctx),
          analyzeHiddenRecurrence(ctx),
          analyzeSalaryRhythm(ctx),
          analyzeCommitment(ctx),
          analyzeOutlierDays(ctx),
          analyzePaymentMix(ctx),
        ];
  const all = runs.flatMap((r) => r.found);
  const sorted = [...all].sort(
    (a, b) =>
      Number(b.em_jogo_cents - a.em_jogo_cents) ||
      ORDER.indexOf(a.analise) - ORDER.indexOf(b.analise) ||
      `${a.recorte.tipo}${a.recorte.chave}${a.corte}`.localeCompare(`${b.recorte.tipo}${b.recorte.chave}${b.corte}`),
  );
  return {
    periodo: { de: ctx.from, ate: ctx.to },
    meses: ctx.nMonths,
    compras_analisadas: ctx.items.length,
    cobertura_hora: ctx.cobertura,
    ciclo_salario: ctx.salaryDates.length >= 2,
    destaques: sorted.slice(0, input.maxDestaques ?? LIMITS.maxDestaques),
    sem_padrao: { avaliadas: runs.reduce((s, r) => s + r.evaluated, 0), aprovadas: all.length },
  };
}

// Total de uma categoria nas mesmas compras (todos os tipos), para a ferramenta
// conferir contra detalhar_categoria. `months` ('YYYY-MM') restringe o período.
export function categoryTotalCents(
  purchases: readonly Purchase[],
  category: string,
  months?: readonly string[],
): bigint {
  let total = 0n;
  for (const p of purchases) {
    if (p.category !== category || p.cents <= 0n) continue;
    if (months && !months.includes(p.date.slice(0, 7))) continue;
    total += p.cents;
  }
  return total;
}
