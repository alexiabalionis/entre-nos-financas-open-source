// Regras da troca de tipo na tela Movimentos (fase 4 de
// docs/SPEC-FATOS-CARTAO.md). Espelham src/server/event-kind.ts, que valida de
// novo: aqui só decidem o que oferecer e o que falta preencher.

export type AdjustKind = "expense" | "income" | "card_purchase" | "refund" | "transfer" | "card_payment";

export const ADJUST_LABEL: Record<AdjustKind, string> = {
  expense: "Gasto",
  income: "Entrada",
  card_purchase: "Compra no crédito",
  refund: "Estorno",
  transfer: "Entre nossas contas",
  card_payment: "Pagamento de fatura",
};

// O que cada tipo faz com os totais, dito para a pessoa.
export const ADJUST_EFFECT: Record<AdjustKind, string> = {
  expense: "Conta como gasto do mês.",
  income: "Conta como entrada do mês.",
  card_purchase: "Conta como gasto e entra na fatura.",
  refund: "Diminui o gasto da compra estornada.",
  transfer: "Não conta como gasto nem entrada. O saldo das contas não muda.",
  card_payment: "Não conta como gasto. A compra já contou quando foi feita.",
};

/** Tipos que cabem num movimento: no cartão, compra ou estorno; na conta, pelo sinal. */
export function kindsFor(accountKind: string, cents: bigint): AdjustKind[] {
  if (accountKind === "card") return cents < 0n ? ["card_purchase"] : ["refund"];
  return cents < 0n ? ["expense", "transfer", "card_payment"] : ["income", "transfer"];
}

export const needsCounter = (k: AdjustKind) => k === "transfer" || k === "card_payment";
export const needsCategory = (k: AdjustKind) => k === "expense" || k === "income" || k === "card_purchase";

/** Outra conta possível: na fatura, só cartões; entre contas, só contas que não são cartão. */
export function counterAccounts<A extends { id: string; kind: string }>(accounts: A[], accountId: string, k: AdjustKind): A[] {
  return accounts.filter(
    (a) => a.id !== accountId && (k === "card_payment" ? a.kind === "card" : a.kind !== "card" && a.kind !== "investment"),
  );
}

export type AdjustDraft = {
  kind: AdjustKind;
  counterAccountId: string | null;
  relatedEventId: string | null;
  categoryId: string | null;
};

/** O campo que falta antes de salvar, ou null. */
export function missingField(d: AdjustDraft): "counter" | "related" | "category" | null {
  if (needsCounter(d.kind) && !d.counterAccountId) return "counter";
  if (d.kind === "refund" && !d.relatedEventId) return "related";
  if (needsCategory(d.kind) && !d.categoryId) return "category";
  return null;
}

/**
 * A outra ponta pendente que o servidor pode ligar ao par: linha do banco na
 * conta escolhida, de valor oposto, até 3 dias de distância (a mesma janela da
 * análise). Só quando há exatamente uma; com mais, não escolhe.
 */
export function otherSide<R extends { id: string; accountId: string; date: string; cents: bigint }>(
  pending: R[],
  counterAccountId: string,
  date: string,
  cents: bigint,
): string | null {
  const day = (d: string) => Date.parse(d + "T12:00:00Z") / 86400000;
  const found = pending.filter(
    (p) => p.accountId === counterAccountId && p.cents === -cents && Math.abs(day(p.date) - day(date)) <= 3,
  );
  return found.length === 1 ? found[0].id : null;
}
