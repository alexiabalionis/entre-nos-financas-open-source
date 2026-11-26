// Regra de cor/rótulo de categoria da tela Mês. Sem React. Extraído de
// month-screen.tsx / projection-view.ts (Etapa 1): a regra "fatura de cartão
// -> Cartões" vivia duplicada em 3 lugares (ícone e cor em pvUpcomingRows, e o
// fallback de summarizeCategories); agora é uma função só.

export const CARDS_LABEL = "Cartões";
export const NO_CATEGORY_LABEL = "Sem categoria";

/** Categoria de exibição de um fluxo: a resolvida pelo coletor, ou "Cartões"
 *  quando é fatura de cartão (key começa com "bill:"), ou null quando nenhuma
 *  das duas — quem chama decide o fallback final (ex.: NO_CATEGORY_LABEL ou o
 *  próprio label do fluxo). */
export function flowCategory(flow: {
  key: string;
  category?: string | null;
}): string | null {
  return flow.category ?? (flow.key.startsWith("bill:") ? CARDS_LABEL : null);
}

/** Cor FIXA da categoria: categories.color_index (migration 024) -> token
 *  --family-cat-N. Nunca pela posição na barra, que muda de mês para mês.
 *  "Cartões" (fatura) e o que não é categoria cadastrada têm token próprio. */
export function categoryColor(
  name: string,
  colorByName: Map<string, number | null>,
): string {
  if (name === CARDS_LABEL) return "var(--family-cat-cards)";
  const index = colorByName.get(name);
  return index == null
    ? "var(--family-cat-none)"
    : `var(--family-cat-${index + 1})`;
}
