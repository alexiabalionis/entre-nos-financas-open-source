/**
 * Transformações puras dos dados de gráfico. SEM "use client", SEM recharts:
 * o encapsulamento do recharts fica nos componentes de gráfico; aqui é só a
 * lógica de dados, testável por tipo e reusável.
 */

/** Ponto de série genérico: x é o rótulo do eixo, v o valor. */
export type SeriesPoint<X extends string | number = string | number> = {
  x: X;
  v: number;
};

/** Ponto dividido em trecho sólido (vs) e tracejado (vd). */
export type SplitPoint<X extends string | number = string | number> = {
  x: X;
  vs: number | null;
  vd: number | null;
};

/**
 * Divide a série em sólido (vs) até splitAt e tracejado (vd) a partir de splitAt.
 * O índice de fronteira entra nas DUAS séries de propósito, pra linha não quebrar
 * no ponto do split. Sem splitAt, o último ponto é a fronteira.
 */
export function splitSeriesAt<T extends { x: string | number; v: number }>(
  data: T[],
  splitAt?: string | number,
): Array<SplitPoint<T["x"]>> {
  const splitIdx =
    splitAt != null ? data.findIndex((p) => p.x === splitAt) : data.length - 1;
  return data.map((p, idx) => ({
    x: p.x,
    vs: idx <= splitIdx ? p.v : null,
    vd: idx >= splitIdx ? p.v : null,
  }));
}

/**
 * Pivota uma lista de segmentos numa única linha {s0, s1, ...} = value,
 * o formato que a barra empilhada 100% espera (uma chave por fatia).
 */
/**
 * Percentuais inteiros de cada peso que SEMPRE somam 100 (maior resto): sem
 * isso, arredondar cada fatia sozinha dá 99% ou 101% no total. Pesos <= 0
 * contam como 0; lista sem peso positivo devolve zeros.
 */
export function percentShares(values: number[]): number[] {
  const safe = values.map((v) => (v > 0 ? v : 0));
  const total = safe.reduce((s, v) => s + v, 0);
  if (total === 0) return safe.map(() => 0);
  const raw = safe.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export function pivotSegments(
  segments: Array<{ value: number }>,
): Record<string, number> {
  const row: Record<string, number> = {};
  segments.forEach((s, i) => {
    row["s" + i] = s.value;
  });
  return row;
}

/**
 * Maior valor absoluto da lista, com piso mínimo (default 1) pra evitar divisão
 * por zero ao normalizar uma escala divergente.
 */
export function maxAbs(values: number[], min = 1): number {
  return Math.max(min, ...values.map(Math.abs));
}
