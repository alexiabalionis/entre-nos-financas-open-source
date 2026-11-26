// Cor específica por categoria para pintar o ícone da transação. A cor é
// derivada do nome (determinística e estável): a mesma categoria sempre recebe
// a mesma cor, sem precisar guardar nada no banco. A paleta é a mesma usada no
// gráfico de pizza do painel, então combina com o resto do app.
export const CATEGORY_PALETTE = [
  "#c5ab8b",
  "#7d9c91",
  "#b8806b",
  "#8f91b0",
  "#d0ba75",
  "#7295aa",
  "#bd91a3",
  "#8d9771",
] as const;

/** Cor fixa da categoria a partir do nome. Vazio/nulo cai na primeira cor. */
export function categoryColor(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  let hash = 0;
  for (let i = 0; i < key.length; i++)
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}
