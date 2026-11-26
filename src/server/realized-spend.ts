import type { Transaction } from "@electric-sql/pglite";
import { economicEffect, type Kind } from "../domain/finance.ts";
import { AUTO_OUTFLOW_SQL } from "../domain/bank-analysis.ts";
import { promptLabel } from "../domain/movements.ts";
import { merchantKey, resolveCategory } from "./assisted.ts";
import type { CardMeta } from "./card-competence.ts";

// Fonte única de "gasto já realizado": eventos aprovados + o que o banco já
// trouxe e ainda está pendente. Só leitura, por família (RLS + household_id).

export type PendingCardPurchase = {
  id: string;
  description: string;
  amount_cents: string;
  transaction_date: string;
  local_account_id: string;
  bank_account_id: string;
  account_name: string;
  card_meta: CardMeta | null;
  alias_name?: string | null;
};

export type AutoCountedChecking = {
  id: string;
  description: string;
  amount_cents: string;
  local_account_id: string;
  transaction_date: string;
  alias_name?: string | null;
};

export type RealizedSpend = {
  date: string;
  cents: bigint;
  scope: string;
  merchant: string;
  // Nome sem dado de pessoa (promptLabel): o único que vai ao provedor de IA.
  label: string;
  categoryName: string | null;
  source: "event" | "pending";
  // Evento de origem; null para lançamento do banco ainda pendente.
  eventId: string | null;
  // Parcela de compra parcelada (card_meta.total_installments > 1). Só o ritmo
  // do Futuro usa, para não contar a parcela duas vezes (dia a dia e fatura).
  installment?: boolean;
};

type Window = { familyId: string; from: string; to: string };

export async function readPendingCardPurchases(
  tx: Transaction,
  p: Window & { accountId?: string | null },
): Promise<PendingCardPurchase[]> {
  return readCardRows(tx, p, "t.status='pending' AND t.event_id IS NULL");
}

/**
 * Compras de cartão do banco ainda sem evento OU com evento criado pelo app
 * (auto_recorded). Serve à cobertura de conta fixa paga pelo banco: a compra
 * paga a conta fixa quer tenha virado evento automático, quer não.
 */
export async function readBankCardPurchases(
  tx: Transaction,
  p: Window & { accountId?: string | null },
): Promise<PendingCardPurchase[]> {
  return readCardRows(
    tx,
    p,
    "(t.status='pending' AND t.event_id IS NULL OR t.auto_recorded)",
  );
}

async function readCardRows(
  tx: Transaction,
  p: Window & { accountId?: string | null },
  scope: string,
): Promise<PendingCardPurchase[]> {
  return (
    await tx.query<PendingCardPurchase>(
      `SELECT t.id,t.description,t.amount_cents::text,t.transaction_date::text,t.local_account_id,t.bank_account_id,a.name AS account_name,t.card_meta,ma.alias AS alias_name
               FROM bank_transactions t
               JOIN accounts a ON a.id=t.local_account_id
               LEFT JOIN merchant_aliases ma ON ma.household_id=t.household_id AND ma.key=merchant_key(t.description)
               WHERE t.household_id=$1 AND a.kind='card'
                 AND ${scope}
                 AND NOT t.changed AND NOT t.missing
                 AND t.currency='BRL' AND t.amount_cents<>0
                 AND coalesce(t.analysis->>'group','') NOT IN ('duplicate','history','card','transfer','investment')
                 AND NOT (t.operation_type ~* 'PAGAMENTO_FATURA' OR t.description ~* 'PAGAMENTO.*FATURA')
                 AND ($4::uuid IS NULL OR t.local_account_id=$4)
                 /* amount_cents<0 = compra; >0 = estorno que abate o gasto
                    do mesmo mês de competência (não é pagamento de fatura,
                    já excluído acima, nem grupo card/transfer/duplicate/history). */
                 AND t.transaction_date>=$2::date
                 AND t.transaction_date<$3::date`,
      [p.familyId, p.from, p.to, p.accountId ?? null],
    )
  ).rows;
}

// Saída AUTOMÁTICA que conta como gasto do mês sem pedir aprovação (Forma B).
// Movimentos de CONTA CORRENTE que contam nos totais SEM aprovação (o que
// já aconteceu entra; aprovar virou só ajuste de categoria). Conta não
// cartão, ainda não virado evento (event_id IS NULL evita dupla contagem),
// e NÃO ambíguo (NOT IN duplicate/history/card/transfer exclui repetição,
// pagamento de fatura e transferência própria com par detectado). Cobre:
//  - GASTO: débito classificado `expense`, OU saída automática
//    PIX/TED/DOC/débito automático de serviço (AUTO_OUTFLOW_SQL) — inclui
//    o PIX para terceiros (sem par -> não é transfer) e o agendado
//    (provider_status=PENDING), ambos gasto do mês da data de saída;
//  - ENTRADA: crédito classificado `income`.
// Transferência própria (par detectado), pagamento de fatura e duplicata
// ficam fora: o grupo já os marca e a UI os exibe neutros/avisados. Cartão
// segue pela competência (readPendingCardPurchases), intocado. Forma 2:
// derivado na soma, sem materializar evento.
export async function readAutoCountedChecking(
  tx: Transaction,
  p: Window,
): Promise<AutoCountedChecking[]> {
  return (
    await tx.query<AutoCountedChecking>(
      `SELECT t.id,t.description,t.amount_cents::text,t.local_account_id,t.transaction_date::text,ma.alias AS alias_name
               FROM bank_transactions t
               JOIN accounts a ON a.id=t.local_account_id
               LEFT JOIN merchant_aliases ma ON ma.household_id=t.household_id AND ma.key=merchant_key(t.description)
               WHERE t.household_id=$1 AND a.kind<>'card'
                 AND t.status='pending' AND t.event_id IS NULL
                 AND NOT t.missing AND NOT t.changed
                 AND t.currency='BRL' AND t.amount_cents<>0
                 AND coalesce(t.analysis->>'group','') NOT IN ('duplicate','history','card','transfer','investment')
                 AND (
                   (t.amount_cents<0 AND (coalesce(t.analysis->>'group','')='expense' OR ${AUTO_OUTFLOW_SQL}))
                   OR (t.amount_cents>0 AND coalesce(t.analysis->>'group','')='income')
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM reserve_movements rm
                   WHERE rm.household_id=t.household_id
                     AND rm.bank_transaction_id=t.id AND rm.voided_at IS NULL)
                 AND t.transaction_date>=$2::date
                 AND t.transaction_date<$3::date`,
      [p.familyId, p.from, p.to],
    )
  ).rows;
}

async function readEventSpend(
  tx: Transaction,
  p: Window,
): Promise<RealizedSpend[]> {
  const rows = (
    await tx.query<{
      id: string;
      kind: Kind;
      amount_cents: string;
      description: string;
      display_name: string | null;
      alias_name: string | null;
      transaction_date: string;
      account_id: string;
      is_card: boolean;
      category_name: string | null;
      installment: boolean;
    }>(
      `SELECT e.id::text,e.kind,e.amount_cents::text,e.description,e.display_name,ma.alias AS alias_name,e.transaction_date::text,
        e.account_id,(a.kind='card') AS is_card,c.name AS category_name,
        EXISTS(SELECT 1 FROM bank_transactions bt WHERE bt.household_id=e.household_id AND bt.event_id=e.id
          AND coalesce((bt.card_meta->>'total_installments')::int,0)>1) AS installment
       FROM economic_events e
       JOIN accounts a ON a.household_id=e.household_id AND a.id=e.account_id
       LEFT JOIN categories c ON c.household_id=e.household_id AND c.id=e.category_id
       LEFT JOIN merchant_aliases ma ON ma.household_id=e.household_id AND ma.key=merchant_key(e.description)
       WHERE e.household_id=$1 AND e.currency='BRL' AND e.cancelled_at IS NULL
         AND e.kind IN ('expense','card_purchase','fee','refund')
         AND e.counter_account_id IS NULL
         AND e.transaction_date>=$2::date AND e.transaction_date<$3::date
       ORDER BY e.transaction_date,e.id`,
      [p.familyId, p.from, p.to],
    )
  ).rows;
  return rows.map((r) => ({
    date: r.transaction_date,
    cents: economicEffect(r.kind, BigInt(r.amount_cents)).expense,
    scope: r.is_card ? r.account_id : "cash",
    merchant: merchantKey(r.description),
    label: promptLabel({ displayName: r.display_name, aliasName: r.alias_name, description: r.description, kind: r.kind, amount: r.amount_cents }),
    categoryName: r.category_name,
    source: "event",
    eventId: r.id,
    installment: r.installment,
  }));
}

export async function readRealizedSpend(
  tx: Transaction,
  p: Window,
): Promise<RealizedSpend[]> {
  const [events, cards, checking, rules] = await Promise.all([
    readEventSpend(tx, p),
    readPendingCardPurchases(tx, p),
    readAutoCountedChecking(tx, p),
    tx.query<{ match_text: string; category_name: string }>(
      "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
      [p.familyId],
    ),
  ]);
  const pending = (
    row: { description: string; amount_cents: string; alias_name?: string | null; card_meta?: CardMeta | null },
    scope: string,
    date: string,
  ): RealizedSpend => ({
    date,
    cents: -BigInt(row.amount_cents),
    scope,
    merchant: merchantKey(row.description),
    label: promptLabel({ aliasName: row.alias_name, description: row.description, kind: null, amount: row.amount_cents }),
    categoryName: resolveCategory(rules.rows, row.description).name,
    source: "pending",
    eventId: null,
    installment: (row.card_meta?.total_installments ?? 0) > 1,
  });
  return [
    ...events,
    // Cartão: valor positivo é estorno e abate o consumo (cents negativo).
    ...cards.map((c) => pending(c, c.local_account_id, c.transaction_date)),
    // Conta corrente: só saída entra aqui; crédito classificado `income` é entrada.
    ...checking
      .filter((c) => BigInt(c.amount_cents) < 0n)
      .map((c) => pending(c, "cash", c.transaction_date)),
  ];
}
