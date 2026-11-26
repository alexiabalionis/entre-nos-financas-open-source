// Cores de dado do Futuro: tokens --family-cat-*, passados por prop e aplicados via style.

// Mesma paleta de app/copilot/money.ts (copiada, não importada).
const GOAL_COLORS = [
  "var(--family-cat-4)",
  "var(--family-cat-6)",
  "var(--family-cat-2)",
  "var(--family-cat-8)",
] as const;

const INSTALLMENT_COLORS = [
  "var(--family-cat-1)",
  "var(--family-cat-3)",
  "var(--family-cat-5)",
  "var(--family-cat-7)",
] as const;

// Categorias na fatura: tokens que não se confundem com estimativa (cat-none),
// valor do banco (cat-9), compra simulada (cat-11) e "Outras" (cat-cards).
const CATEGORY_COLORS = [
  "var(--family-cat-1)",
  "var(--family-cat-3)",
  "var(--family-cat-5)",
  "var(--family-cat-7)",
  "var(--family-cat-4)",
  "var(--family-cat-2)",
] as const;

const wrap = (i: number, size: number) => ((Math.trunc(i) % size) + size) % size;

/** Cor de dado de um objetivo pela posição; repete a paleta quando passa de quatro. */
export function goalColor(index: number): string {
  return GOAL_COLORS[wrap(index, GOAL_COLORS.length)];
}

/** Cor de dado de cada camada da fatura. Parcelas variam pela posição (`index`). */
export function cardLayerColor(
  kind: "recorrente" | "estimado" | "parcela" | "fatura" | "pontual",
  index = 0,
): string {
  switch (kind) {
    case "recorrente":
      return "var(--family-cat-cards)";
    case "estimado":
      return "var(--family-cat-none)";
    case "parcela":
      return INSTALLMENT_COLORS[wrap(index, INSTALLMENT_COLORS.length)];
    case "fatura":
      return "var(--family-cat-9)";
    case "pontual":
      return "var(--family-cat-11)";
  }
}

/** Cor de dado de uma categoria na fatura, pela posição (a maior é 0). */
export function categoryLayerColor(index: number): string {
  return CATEGORY_COLORS[wrap(index, CATEGORY_COLORS.length)];
}

// Degradê da cor de "Demais categorias" (não a paleta de categoria nomeada:
// senão uma delas repetiria a cor de uma categoria de verdade em outro lugar
// da mesma barra). Mistura com a superfície do tema, então clareia no claro e
// escurece no escuro — a direção certa nos dois temas, sem fixar branco/preto.
const OUTRAS_MIX_PCT = [0, 22, 38, 52] as const;

/** Cor de cada categoria dentro de "Demais categorias", pela posição (a maior é 0). */
export function outrasLayerColor(index: number): string {
  const pct = OUTRAS_MIX_PCT[wrap(index, OUTRAS_MIX_PCT.length)];
  const base = cardLayerColor("recorrente");
  return pct === 0 ? base : `color-mix(in srgb, ${base} ${100 - pct}%, var(--family-surface) ${pct}%)`;
}
