import type { Transaction } from "@electric-sql/pglite";
import {
  cardCompetence,
  type Competence,
  type CycleVersion,
} from "../domain/card-competence.ts";
import { economicEffect, type Kind } from "../domain/finance.ts";
import { eventName } from "../domain/event-name.ts";
import { readCycleVersions } from "./card-cycle.ts";

export type CardMeta = {
  bill_id?: string | null;
  installment_number?: number | null;
  total_installments?: number | null;
  purchase_date?: string | null;
};
export type CardCompetenceContext = {
  versions: Map<string, CycleVersion[]>;
  billDue: Map<string, string>;
};

// Parcelas e faturas chegam até ~24 meses depois da compra: janela de leitura
// dos lançamentos de cartão que podem ter competência no mês da tela. 25 cobre
// os 24x com folga de um mês.
export const CARD_LOOKBACK_MONTHS = 25;

/** Chave composta do vencimento de uma fatura: um remote_id só é único por banco. */
function billKey(bankAccountId: string, remoteId: string) {
  return bankAccountId + ":" + remoteId;
}

/** Versões de ciclo e vencimentos das faturas lidas do banco, uma vez por leitura. */
export async function loadCardCompetence(
  tx: Transaction,
  familyId: string,
): Promise<CardCompetenceContext> {
  const bills = (
    await tx.query<{
      bank_account_id: string;
      remote_id: string;
      due_date: string;
    }>(
      "SELECT bank_account_id,remote_id::text,due_date::text FROM bank_card_bills WHERE household_id=$1",
      [familyId],
    )
  ).rows;
  return {
    versions: await readCycleVersions(tx, familyId),
    billDue: new Map(
      bills.map((b) => [billKey(b.bank_account_id, b.remote_id), b.due_date]),
    ),
  };
}

/**
 * Competência de um lançamento de cartão, pendente (bank_transactions) ou
 * aprovado (economic_events): mesma regra, só muda de onde vêm os campos. O
 * vencimento da fatura identificada vem da chave composta banco+bill_id, pois
 * um remote_id de fatura só é único dentro do mesmo cartão (bank_account_id).
 */
export function competenceOf(
  ctx: CardCompetenceContext,
  row: {
    account_id: string;
    bank_account_id?: string | null;
    transaction_date: string;
    due_date?: string | null;
    card_meta?: CardMeta | null;
  },
): Competence {
  const meta = row.card_meta ?? {};
  const k = meta.installment_number ?? null,
    n = meta.total_installments ?? null;
  const billDueDate =
    meta.bill_id && row.bank_account_id
      ? (ctx.billDue.get(billKey(row.bank_account_id, meta.bill_id)) ?? null)
      : null;
  return cardCompetence({
    transactionDate: row.transaction_date,
    purchaseDate: meta.purchase_date ?? null,
    billDueDate,
    declaredDueDate: row.due_date ?? null,
    installment: k && n ? { number: k, total: n } : null,
    cycles: ctx.versions.get(row.account_id) ?? [],
  });
}

/**
 * Mês do orçamento de um lançamento de cartão. Sem competência conhecida
 * (cartão sem fechamento informado), usa o mês da compra e marca como
 * estimado, para o gasto não sumir dos totais. Vale igual para pendente e
 * aprovado.
 */
export function budgetMonthOf(c: Competence, transactionDate: string) {
  return c.month
    ? { month: c.month, estimated: false }
    : { month: transactionDate.slice(0, 7), estimated: true };
}

export type CardEventRow = {
  id: string;
  kind: Kind;
  description: string;
  display_name: string | null;
  name: string;
  amount_cents: string;
  currency: string;
  transaction_date: string;
  due_date: string | null;
  account_id: string;
  account_name: string;
  category_id: string | null;
  bank_account_id: string | null;
  card_meta: CardMeta | null;
  competence: Competence;
  budget: { month: string; estimated: boolean };
};

/**
 * Eventos aprovados em contas de cartão que podem ter competência no mês
 * (janela de CARD_LOOKBACK_MONTHS), já com a competência calculada. Os
 * filtros opcionais são os mesmos da tela Mês. Traz o bank_account_id da
 * linha do banco de origem para a chave composta da fatura.
 */
export async function readCardEvents(
  tx: Transaction,
  ctx: CardCompetenceContext,
  q: {
    familyId: string;
    month: string; // YYYY-MM-01
    currency: string;
    accountId?: string | null;
    categoryId?: string | null;
    // true: lê as moedas DIFERENTES de q.currency (aviso de gasto estrangeiro).
    otherCurrencies?: boolean;
  },
): Promise<CardEventRow[]> {
  const currencyOp = q.otherCurrencies ? "<>" : "=";
  const rows = (
    await tx.query<Omit<CardEventRow, "competence" | "budget" | "name">>(
      `SELECT e.id,e.kind,e.description,e.display_name,e.amount_cents::text,e.currency,e.transaction_date::text,e.due_date::text,e.account_id,a.name AS account_name,e.category_id,
        (SELECT bt.bank_account_id FROM bank_transactions bt WHERE bt.event_id=e.id AND bt.household_id=e.household_id ORDER BY bt.created_at,bt.id LIMIT 1) AS bank_account_id,
        (SELECT bt.card_meta FROM bank_transactions bt WHERE bt.event_id=e.id AND bt.household_id=e.household_id ORDER BY bt.created_at,bt.id LIMIT 1) AS card_meta
       FROM economic_events e JOIN accounts a ON a.id=e.account_id
       WHERE e.household_id=$1 AND a.kind='card' AND e.currency${currencyOp}$2 AND e.cancelled_at IS NULL
         AND e.transaction_date>=($3::date-make_interval(months=>$6))
         AND e.transaction_date<($3::date+interval '1 month')
         AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM ledger_entries l WHERE l.event_id=e.id AND l.account_id=$4))
         AND ($5::uuid IS NULL OR e.category_id=$5)`,
      [
        q.familyId,
        q.currency,
        q.month,
        q.accountId ?? null,
        q.categoryId ?? null,
        CARD_LOOKBACK_MONTHS,
      ],
    )
  ).rows;
  return rows.map((r) => {
    const competence = competenceOf(ctx, r);
    return {
      ...r,
      name: eventName(r),
      competence,
      budget: budgetMonthOf(competence, r.transaction_date),
    };
  });
}

export type OtherCurrencyCardSpend = {
  currency: string;
  count: number;
  amount_cents: string;
};

/**
 * Eventos aprovados em contas de cartão na MESMA janela que readCardEvents
 * varre, mas em moeda DIFERENTE da pedida pela tela. A tela de orçamento soma
 * por moeda (readCardEvents filtra e.currency=$2), então um gasto no cartão em
 * outra moeda some do total. Aqui apenas detectamos a existência desses gastos,
 * somando POR MOEDA, SEM converter: não há taxa de câmbio e não se inventa
 * valor em reais. O consumidor usa isto para um aviso visível de que há gasto
 * estrangeiro fora do total, nunca para alterar o total.
 */
export async function readOtherCurrencyCardSpend(
  tx: Transaction,
  q: {
    familyId: string;
    month: string; // YYYY-MM-01
    currency: string;
    accountId?: string | null;
    categoryId?: string | null;
  },
): Promise<OtherCurrencyCardSpend[]> {
  // Só despesa real (economicEffect) cuja competência cai no mês pedido:
  // compra antiga, estorno e pagamento de fatura não mantêm o aviso.
  const ctx = await loadCardCompetence(tx, q.familyId);
  const events = await readCardEvents(tx, ctx, { ...q, otherCurrencies: true });
  const monthKey = q.month.slice(0, 7);
  const byCurrency = new Map<string, { count: number; sum: bigint }>();
  for (const e of events) {
    const amount = BigInt(e.amount_cents);
    if (e.budget.month !== monthKey || economicEffect(e.kind, amount).expense <= 0n)
      continue;
    const cur = byCurrency.get(e.currency) ?? { count: 0, sum: 0n };
    cur.count += 1;
    cur.sum += amount;
    byCurrency.set(e.currency, cur);
  }
  return [...byCurrency.keys()].sort().map((currency) => ({
    currency,
    count: byCurrency.get(currency)!.count,
    amount_cents: byCurrency.get(currency)!.sum.toString(),
  }));
}
