export type BarRect = { col: number; layer: number; x: number; y: number; w: number; h: number };

/**
 * Geometria das barras empilhadas. `bottom` é a coordenada y da linha de base
 * (as camadas crescem para cima a partir dela) e `top` é a folga acima da maior
 * barra. `max` opcional fixa a escala (para o desenho não reescalar durante o tween).
 */
export function barGeometry(args: {
  values: number[][];
  ghost?: (number | null)[];
  width: number;
  height: number;
  top: number;
  bottom: number;
  minColumnWidth: number;
  max?: number;
}): {
  width: number;
  col: number;
  barW: number;
  max: number;
  rects: BarRect[];
  totals: number[];
} {
  const { values, ghost, height, top, bottom, minColumnWidth } = args;
  const n = Math.max(1, values.length);
  const width = Math.max(args.width, n * minColumnWidth);
  const col = width / n;
  const barW = Math.min(44, col * 0.62);
  const totals = values.map((v) => v.reduce((a, x) => a + x, 0));
  const natural = Math.max(1, ...totals, ...(ghost ?? []).map((g) => g ?? 0));
  const max = args.max ?? natural;
  const k = Math.max(0, bottom - top) / max;
  void height;
  const rects: BarRect[] = [];
  values.forEach((layers, c) => {
    let acc = 0;
    layers.forEach((v, l) => {
      if (v > 0.5) {
        const h = v * k;
        rects.push({ col: c, layer: l, x: (c + 0.5) * col - barW / 2, y: bottom - (acc + v) * k, w: barW, h });
      }
      acc += v;
    });
  });
  return { width, col, barW, max, rects, totals };
}

/** Quais camadas têm algum valor > 0 (para a legenda não mostrar camadas vazias). */
export function usedLayers(values: number[][], layerCount: number): boolean[] {
  return Array.from({ length: layerCount }, (_, l) => values.some((row) => (row[l] ?? 0) > 0));
}
