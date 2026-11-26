/** Fração (0–1) da largura preenchida pela barra. */
export function laneFill(end: number | null, columns: number): number {
  if (end === null) return 1;
  if (columns <= 0) return 0;
  return Math.max(0, Math.min(1, (end + 1) / columns));
}

/** Posição (0–1) da bandeira, ou null se não houver bandeira. */
export function flagAt(end: number | null, columns: number): number | null {
  if (end === null || columns <= 0 || end >= columns) return null;
  return (end + 0.5) / columns;
}

/** Coluna clicada a partir da posição relativa do clique (0–1). */
export function columnAt(fraction: number, columns: number): number {
  return Math.max(0, Math.min(columns - 1, Math.floor(fraction * columns)));
}
