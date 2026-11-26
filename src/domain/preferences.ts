export const homeCards = [
  ["receipts", "Recebimentos para o próximo mês"],
  ["alerts", "Alarmes e vencimentos"],
  ["cards", "Cartões do mês"],
  ["income", "Entradas previstas"],
  ["fixed", "Custos fixos"],
  ["variable", "Custos variáveis"],
  ["saving", "Reservas e objetivos"],
  // Etapa 3: blocos da tela Mês (app/month/blocks/registry.ts) virando cards
  // personalizáveis da home. Entram no fim — quem já tem card_order salvo
  // (9 ids) recebe estes 4 ao final via normalizeHomeOrder. Labels iguais
  // aos de MONTH_BLOCKS; mantidos aqui porque o domínio não importa de app/.
  ["upcoming", "Vem aí"],
  ["pending", "Precisa de você"],
  ["path", "Caminho do saldo"],
  ["composition", "Saídas por categoria"],
  // Etapa 4: "summary" (Resumo do mês) e "categories" (Gráfico por categoria)
  // saíram daqui — o topo fixo (HeroBlock) e o card "composition" acima os
  // substituem na tela Mês. normalizeHomeOrder descarta os dois ids, que
  // ainda podem existir em card_order salvo de usuárias antigas.
] as const;
export type HomeCardId = (typeof homeCards)[number][0];
export type Preferences = {
  accent: string;
  theme: "system" | "light" | "dark";
  card_order: HomeCardId[];
  hidden_cards: HomeCardId[];
  revision: number;
  has_photo: boolean;
  onboarding_done: boolean;
};
export const defaultPreferences: Preferences = {
  accent: "#5844d8",
  theme: "system",
  card_order: homeCards.map((c) => c[0]),
  hidden_cards: [],
  revision: 0,
  has_photo: false,
  onboarding_done: false,
};
export function accentForeground(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#161616" : "#ffffff";
}

export function reorderCard(
  order: HomeCardId[],
  id: HomeCardId,
  target: HomeCardId,
  after = false,
): HomeCardId[] {
  if (id === target || !order.includes(id) || !order.includes(target))
    return order;
  const next = order.filter((x) => x !== id);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, id);
  return next;
}
const knownCardIds: readonly HomeCardId[] = homeCards.map((c) => c[0]);
function isKnownCardId(id: unknown): id is HomeCardId {
  return typeof id === "string" && (knownCardIds as readonly string[]).includes(id);
}
// Genérica para sobreviver à etapa 4 (remoção de summary/categories): ids
// desconhecidos (vindos de preferências futuras antigas, ou lixo) são
// descartados; ids conhecidos faltando (blocos novos) são acrescentados no
// fim, na ordem de homeCards. Idempotente: aplicar 2x = aplicar 1x.
export function normalizeHomeOrder(
  order: readonly string[],
  hidden: readonly string[],
): { card_order: HomeCardId[]; hidden_cards: HomeCardId[] } {
  const seen = new Set<HomeCardId>();
  const card_order: HomeCardId[] = [];
  for (const id of order) {
    if (isKnownCardId(id) && !seen.has(id)) {
      seen.add(id);
      card_order.push(id);
    }
  }
  for (const id of knownCardIds) {
    if (!seen.has(id)) {
      seen.add(id);
      card_order.push(id);
    }
  }
  const seenHidden = new Set<HomeCardId>();
  const hidden_cards: HomeCardId[] = [];
  for (const id of hidden) {
    if (isKnownCardId(id) && !seenHidden.has(id)) {
      seenHidden.add(id);
      hidden_cards.push(id);
    }
  }
  return { card_order, hidden_cards };
}

export function moveVisibleCard(
  order: HomeCardId[],
  hidden: HomeCardId[],
  id: HomeCardId,
  delta: number,
) {
  const visible = order.filter((x) => !hidden.includes(x)),
    index = visible.indexOf(id),
    target = visible[index + delta];
  return index < 0 || !target
    ? order
    : reorderCard(order, id, target, delta > 0);
}
