/**
 * Dados fictícios e regras da vitrine de ajuste de Movimentos. As regras
 * espelham o servidor (src/server/event-kind.ts e event-cancel.ts): no cartão
 * só compra e estorno; entre contas e fatura pedem a outra conta; estorno pede a
 * compra de origem do mesmo cartão e não passa do valor dela; remover não apaga;
 * voltar a contar é recusado enquanto o banco não traz o movimento. Sem rede.
 */
export type AccountKind = "checking" | "card";
export type Account = { id: string; name: string; kind: AccountKind };
export type Kind = "expense" | "income" | "card_purchase" | "refund" | "transfer" | "card_payment";
export type Row = {
  id: string;
  date: string;
  description: string;
  accountId: string;
  cents: number;
  kind: Kind;
  category: string | null;
  counterId: string | null;
  relatedId: string | null;
  auto: boolean;
  removed: "" | "você" | "banco";
};
export type Scenario = "normal" | "removido" | "sumiu" | "leitura";

export const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "removido", label: "Com um removido" },
  { value: "sumiu", label: "Sumiu do banco" },
  { value: "leitura", label: "Somente leitura" },
];

export const ACCOUNTS: Account[] = [
  { id: "corrente", name: "Conta corrente", kind: "checking" },
  { id: "reserva", name: "Conta reserva", kind: "checking" },
  { id: "cartao", name: "Cartão principal", kind: "card" },
];
export const CATEGORIES = ["Mercado", "Transporte", "Compras pessoais", "Casa", "Lazer", "Saúde", "Receitas profissionais"];

export const KIND_LABEL: Record<Kind, string> = {
  expense: "Gasto",
  income: "Entrada",
  card_purchase: "Compra no crédito",
  refund: "Estorno",
  transfer: "Entre nossas contas",
  card_payment: "Pagamento de fatura",
};

export const account = (id: string | null) => ACCOUNTS.find((a) => a.id === id);
export const kindsFor = (r: Row): Kind[] =>
  account(r.accountId)?.kind === "card"
    ? r.cents < 0
      ? ["card_purchase"]
      : ["refund"]
    : r.cents < 0
      ? ["expense", "transfer", "card_payment"]
      : ["income", "transfer"];
export const needsCounter = (k: Kind) => k === "transfer" || k === "card_payment";
export const neutral = (k: Kind) => needsCounter(k);
export const counterOptions = (r: Row, k: Kind) =>
  ACCOUNTS.filter((a) => a.id !== r.accountId && (k === "card_payment" ? a.kind === "card" : a.kind === "checking"));
export const refundOptions = (rows: Row[], r: Row) =>
  rows.filter((p) => p.kind === "card_purchase" && p.accountId === r.accountId && !p.removed && -p.cents >= r.cents);

const row = (r: Partial<Row> & Pick<Row, "id" | "date" | "description" | "accountId" | "cents" | "kind">): Row => ({
  category: null,
  counterId: null,
  relatedId: null,
  auto: true,
  removed: "",
  ...r,
});

export function initialRows(s: Scenario): Row[] {
  return [
    row({ id: "m1", date: "2026-11-21", description: "MERCADO BOM PRECO", accountId: "cartao", cents: -18740, kind: "card_purchase", category: "Mercado" }),
    row({ id: "m2", date: "2026-11-21", description: "BOLETO 8842 1190", accountId: "corrente", cents: -30000, kind: "expense", category: "Casa" }),
    row({ id: "m3", date: "2026-11-20", description: "PIX TRANSFERENCIA ENVIADA", accountId: "corrente", cents: -50000, kind: "transfer", counterId: "reserva" }),
    row({ id: "m4", date: "2026-11-20", description: "LOJA ROUPAS CENTRO", accountId: "cartao", cents: -10000, kind: "card_purchase", category: "Compras pessoais" }),
    row({ id: "m5", date: "2026-11-19", description: "CREDITO 7731", accountId: "cartao", cents: 4000, kind: "refund", relatedId: null }),
    row({
      id: "m6",
      date: "2026-11-19",
      description: "UBER *TRIP",
      accountId: "cartao",
      cents: -2350,
      kind: "card_purchase",
      category: "Transporte",
      removed: s === "removido" ? "você" : s === "sumiu" ? "banco" : "",
    }),
  ];
}

export type Change = { kind: Kind; category: string | null; counterId: string | null; relatedId: string | null };
export type Action =
  | { type: "reset"; rows: Row[] }
  | { type: "change"; id: string; change: Change }
  | { type: "remove"; id: string }
  | { type: "restore"; id: string };

/** Erro de validação de uma troca de tipo, ou "" quando pode salvar. */
export function changeError(rows: Row[], r: Row, c: Change): string {
  if (!kindsFor(r).includes(c.kind)) return "Esse tipo não combina com este movimento.";
  if (needsCounter(c.kind) && !c.counterId) return "Escolha a outra conta.";
  if (c.kind === "refund" && !c.relatedId) return "Escolha a compra que foi estornada.";
  if (c.kind === "refund" && !refundOptions(rows, r).some((p) => p.id === c.relatedId))
    return "O estorno passa do valor da compra.";
  if (!neutral(c.kind) && c.kind !== "refund" && !c.category) return "Escolha a categoria.";
  return "";
}

export function reducer(rows: Row[], a: Action): Row[] {
  if (a.type === "reset") return a.rows;
  return rows.map((r) => {
    if (r.id !== a.id) return r;
    if (a.type === "remove") return { ...r, removed: "você" };
    if (a.type === "restore") return r.removed === "banco" ? r : { ...r, removed: "" };
    const c = a.change;
    return {
      ...r,
      kind: c.kind,
      auto: false,
      counterId: needsCounter(c.kind) ? c.counterId : null,
      relatedId: c.kind === "refund" ? c.relatedId : null,
      category: neutral(c.kind) ? null : c.kind === "refund" ? (rows.find((p) => p.id === c.relatedId)?.category ?? null) : c.category,
    };
  });
}

export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
