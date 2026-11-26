import { economicEffect, type Kind } from "./finance.ts";
import { maskLongNumbers, readable } from "./format.ts";

export type Movement = {
  id: string;
  date: string;
  description: string;
  // Apelido de exibição (só em lançamentos confirmados). Não substitui a
  // description, que segue como chave de regras.
  name?: string;
  // Só o apelido que a pessoa deu (display_name), sem cair na descrição.
  displayName?: string | null;
  // Apelido do destinatário ou lugar (merchant_aliases); perde para displayName.
  aliasName?: string | null;
  account: string;
  category: string | null;
  // Etiqueta da categoria (lançamentos confirmados e movimentos do banco).
  tag?: string | null;
  amount: string;
  kind: string | null;
  review: boolean;
  duplicate: boolean;
  // Fonte da linha a conferir: "import" (staged_transactions) ou "bank"
  // (bank_transactions, leitura do banco conectado). Ausente em lançamentos
  // confirmados. "blocked" marca um pendente do banco que o fluxo ainda não
  // deixa registrar (provisório/alterado/sumido).
  source?: "import" | "bank";
  blocked?: boolean;
  // Nome do cartão quando a linha é uma compra de cartão de crédito; a timeline
  // mostra como um rótulo pequeno (ex.: "· PERSONNALITE BLACK"). A compra
  // aparece na data da compra; o impacto no orçamento é no vencimento da fatura
  // (calculado no servidor), não aqui.
  cardLabel?: string;
  // Verdadeiro quando é um PIX/transferência agendado (saída futura ainda não
  // debitada pelo banco). A linha já conta como gasto do mês (somado no
  // servidor) e não pede aprovação; a timeline mostra o selo "Agendado".
  scheduled?: boolean;
  // Versão da leitura do banco (linhas "bankpending:"), para registrá-la.
  bankVersion?: number;
  // Verdadeiro quando o lançamento é despesa ligada a uma conta fixa (série).
  fixed?: boolean;
  // Fase 4 de docs/SPEC-FATOS-CARTAO.md (só lançamentos confirmados): conta e
  // contrapartida, compra de origem do estorno, se o app decidiu o tipo, e
  // removido ("person": a pessoa tirou e pode voltar; "bank": o banco deixou de
  // trazer e só volta sozinho).
  accountId?: string;
  counterAccountId?: string | null;
  relatedEventId?: string | null;
  auto?: boolean;
  removed?: "person" | "bank" | null;
  // Conta do app (accounts.id) da linha do banco pendente.
  localAccountId?: string;
};
/** Linha do banco conectado ainda não salva como lançamento (state.bankPending). */
export type BankPendingRow = {
  id: string;
  version: number;
  local_account_id?: string;
  transaction_date: string;
  description: string;
  amount_cents: string;
  account_name: string;
  account_kind: string;
  group: string | null;
  autospend: boolean;
  scheduled: boolean;
  suggested_category: string;
  tag_id: string | null;
  tag_name: string | null;
  alias_name?: string | null;
};
/**
 * Movimento do banco na timeline. Nunca pede aprovação: o que o banco leu já
 * aconteceu e conta sozinho; a única ação é remover.
 *  - Repetição de um lançamento existente (duplicate/history) junta-se a ele e
 *    não aparece de novo: retorna null.
 *  - Transferência própria e aplicação/resgate são neutras.
 *  - Pagamento de fatura é neutro (a saída é a competência das compras).
 *  - Compra de cartão fica com kind=null: o gasto é somado pela fatura no
 *    servidor; aqui só aparece com o rótulo do cartão.
 *  - O resto conta pelo sinal: saída é gasto, crédito é entrada.
 */
export function bankMovement(r: BankPendingRow): Movement | null {
  if (r.group === "duplicate" || r.group === "history") return null;
  const card = r.account_kind === "card";
  const outflow = BigInt(r.amount_cents) < 0n;
  const kind = r.autospend
    ? "expense"
    : card
      ? null
      : r.group === "card"
        ? "card_payment"
        : r.group === "transfer"
          ? "transfer"
          : r.group === "investment"
            ? outflow
              ? "investment_buy"
              : "investment_sell"
            : outflow
              ? "expense"
              : "income";
  return {
    id: "bankpending:" + r.id,
    date: r.transaction_date,
    description: r.description,
    name: r.alias_name?.trim() || undefined,
    aliasName: r.alias_name ?? null,
    account: r.account_name,
    category:
      card || kind === "expense" || kind === "income"
        ? r.suggested_category
        : null,
    tag: r.tag_name,
    amount: r.amount_cents,
    kind,
    review: false,
    duplicate: false,
    source: "bank",
    cardLabel: card ? r.account_name : undefined,
    scheduled: r.scheduled,
    bankVersion: r.version,
    localAccountId: r.local_account_id,
  };
}
/** Título exibido: o apelido quando tem texto, senão a descrição original. */
export function movementTitle(
  row: Pick<Movement, "name" | "description">,
): string {
  const nick = row.name?.trim();
  return nick ? nick : row.description;
}

/** Linhas que a tela Movimentos mostra para um mês (state de family/state). */
export type MovementSource = {
  events: {
    id: string;
    transaction_date: string;
    description: string;
    name?: string;
    display_name?: string | null;
    alias_name?: string | null;
    account_name: string;
    category_name: string | null;
    tag_name: string | null;
    amount_cents: string;
    kind: string;
    fixed?: boolean;
    account_id?: string;
    counter_account_id?: string | null;
    related_event_id?: string | null;
    cancelled_at?: string | null;
    auto?: boolean;
    gone?: boolean;
  }[];
  bankRows: {
    id: string;
    recorded: boolean;
    transaction_date: string;
    description: string;
    account_name: string;
    category_name: string | null;
    amount_cents: string;
    event_kind: string | null;
    duplicate_hint: boolean;
  }[];
  bankPending: BankPendingRow[];
};
export function movementRows(state: MovementSource): Movement[] {
  return [
    ...state.events.map((e) => ({
      id: "event:" + e.id,
      date: e.transaction_date,
      description: e.description,
      name: e.name,
      displayName: e.display_name ?? null,
      aliasName: e.alias_name ?? null,
      account: e.account_name,
      category: e.category_name,
      tag: e.tag_name,
      amount: e.amount_cents,
      kind: e.kind,
      review: false,
      duplicate: false,
      fixed: e.fixed,
      accountId: e.account_id,
      counterAccountId: e.counter_account_id ?? null,
      relatedEventId: e.related_event_id ?? null,
      auto: e.auto ?? false,
      removed: e.cancelled_at ? (e.gone ? ("bank" as const) : ("person" as const)) : null,
    })),
    ...state.bankRows
      .filter((r) => !r.recorded)
      .map((r) => ({
        id: "bank:" + r.id,
        date: r.transaction_date,
        description: r.description,
        account: r.account_name,
        category: r.category_name,
        amount: r.amount_cents,
        kind: r.event_kind,
        review: true,
        duplicate: r.duplicate_hint,
        source: "import" as const,
      })),
    // Movimentos do banco contam sozinhos (bankMovement); repetições de um
    // lançamento existente já estão nele e não aparecem de novo.
    ...state.bankPending.flatMap((r) => bankMovement(r) ?? []),
  ];
}

const TRANSFER = /\b(pix|ted|doc|transf\w*)\b/i;
/**
 * Nome do lançamento que pode ir ao provedor de IA (SPEC-JUDITE-COPILOTO):
 * o apelido, ou a descrição legível sem números longos. Pix e transferência
 * nunca levam o nome de quem pagou ou recebeu.
 */
export function promptLabel(
  row: Pick<Movement, "displayName" | "aliasName" | "description" | "kind" | "amount">,
): string {
  const nick = row.displayName?.trim() || row.aliasName?.trim();
  if (nick) return nick;
  const out = BigInt(row.amount) < 0n;
  if (TRANSFER.test(row.description) || row.kind === "transfer") {
    const pix = /\bpix\b/i.test(row.description);
    return `${pix ? "Pix" : "Transferência"} ${out ? "enviad" : "recebid"}${pix ? "o" : "a"}`;
  }
  return readable(maskLongNumbers(row.description));
}
export type MovementFilter =
  "all" | "income" | "expense" | "transfer" | "card" | "review" | "fixed";
export function movementGroup(row: Movement): MovementFilter {
  if (row.review) return "review";
  if (["income", "yield"].includes(row.kind ?? "")) return "income";
  if (["expense", "fee", "refund"].includes(row.kind ?? "")) return "expense";
  if (["transfer", "fx"].includes(row.kind ?? "")) return "transfer";
  if (["card_purchase", "card_payment"].includes(row.kind ?? "")) return "card";
  // Compra de cartão pendente de pagamento entra com kind=null (fora dos
  // totais), mas carrega o rótulo do cartão: classifica pelo cardLabel para
  // aparecer no filtro "Cartão", não em "all".
  if (row.cardLabel) return "card";
  return "all";
}
const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
// "fixed" não é um grupo: atravessa os outros (um gasto fixo também é gasto).
// Vale o movimento ligado a uma conta fixa (event.fixed, calculado no servidor).
function matches(row: Movement, filter: MovementFilter): boolean {
  if (filter === "all") return true;
  if (filter === "fixed") return row.fixed === true;
  return movementGroup(row) === filter;
}
export type MovementFilters = {
  query: string;
  filter: MovementFilter;
  account?: string;
  category?: string;
  tag?: string;
};
export function visibleMovements(rows: Movement[], filters: MovementFilters) {
  const { query, filter, account = "", category = "", tag = "" } = filters;
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return rows
    .filter((row) => {
      const text = normalized(
        [
          row.description,
          row.name ?? "",
          row.account,
          row.category ?? "",
          row.tag ?? "",
        ].join(" "),
      );
      return (
        (!account || row.account === account) &&
        (!category || row.category === category) &&
        (!tag || row.tag === tag) &&
        matches(row, filter) &&
        terms.every((term) => text.includes(term))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function movementTotals(rows: Movement[]) {
  let income = 0n,
    expense = 0n,
    review = 0,
    transfers = 0;
  for (const row of rows) {
    if (row.review) {
      review++;
      continue;
    }
    // Removido: continua na lista, fora dos totais.
    if (row.removed) continue;
    if (["transfer", "fx"].includes(row.kind ?? "")) transfers++;
    const effect = economicEffect(row.kind as Kind, BigInt(row.amount));
    income += effect.income;
    expense += effect.expense;
  }
  return {
    income: income.toString(),
    expense: expense.toString(),
    review,
    transfers,
  };
}
