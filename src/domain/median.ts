// Mediana de centavos (pura). Ímpar: o valor do meio. Par: média inteira
// (truncada) dos dois do meio. Lista vazia não tem mediana: lança erro, quem
// chama decide antes se há dados suficientes.
export function median(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError("median: lista vazia");
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}
