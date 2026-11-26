// O que cabe por mês, pela sobra de verdade (o "Sobra por mês" do Panorama),
// não pela folga projetada: o plano não projeta o dia a dia e superestima o
// que sobra (decisão de 19/11/2026). Sem React e sem banco, para ser testado.
import type { SobraHistory } from "./future-months.ts";

const STEP = 5000n; // sugestões em múltiplos de R$ 50

/** Arredonda para baixo em R$ 50 (nunca negativo). */
export function floor50(cents: bigint): bigint {
  return cents > 0n ? (cents / STEP) * STEP : 0n;
}

/** Espaço para um compromisso novo: a sobra média menos os aportes que já estão no plano. */
export function roomFor(history: SobraHistory, planned: bigint): bigint {
  return history.avg - planned;
}

/** Meses fechados em que, já tirando os aportes do plano, sobrou menos que `commit`. */
export function shortMonths(history: SobraHistory, planned: bigint, commit: bigint): string[] {
  return history.kept.filter((k) => k.cents - planned < commit).map((k) => k.month);
}

export type Step = { cents: bigint; short: number };

/**
 * Valores menores que `current`, cada um com menos meses em que teria faltado
 * (o maior valor de cada degrau). Ajuda a escolher entre "quanto" e "quantas
 * vezes teria apertado". Até `max` degraus, do maior para o menor; nunca acima
 * do espaço médio, sempre em R$ 50 e maior que zero.
 */
export function ladder(history: SobraHistory, planned: bigint, current: bigint, max = 3): Step[] {
  const room = floor50(roomFor(history, planned));
  const now = shortMonths(history, planned, current).length;
  // Os pontos onde o número de meses curtos muda: a sobra de cada mês fechado.
  const points = new Set<bigint>([room, ...history.kept.map((k) => floor50(k.cents - planned))]);
  const best = new Map<number, bigint>();
  for (const cents of points) {
    if (cents <= 0n || cents >= current || cents > room) continue;
    const short = shortMonths(history, planned, cents).length;
    if (short >= now && current <= room) continue;
    const prev = best.get(short);
    if (prev === undefined || cents > prev) best.set(short, cents);
  }
  return [...best.entries()]
    .map(([short, cents]) => ({ cents, short }))
    .sort((a, b) => (a.cents > b.cents ? -1 : 1))
    .slice(0, max);
}
