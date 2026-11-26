import type { Transaction } from "@electric-sql/pglite";
import type { ItemInput } from "../domain/projection-items.ts";
import type {
  ReceiptInput,
  ScheduledInput,
} from "../domain/projection-cash.ts";
import { includedInCashSql } from "./projection-reads.ts";
import { scheduledSql, settledSql } from "./bank-settled.ts";
import { loadSeriesContexts } from "./recurrence-match.ts";
import { readBankCover } from "./fixed-bank-cover.ts";

// F1a do Copiloto (leituras do plano): itens do plano, recebimentos previstos e
// saídas agendadas. Toda leitura é por família (RLS cuida do escopo); nada aqui
// registra lançamento.

// Itens do plano (monthly_items) do mês atual e do seguinte -> ItemInput[].
// income/benefit/derived são tratados pelo próprio reconcile (ignorados ou via
// receipts); mandamos todos e deixamos a regra pura filtrar.
export async function readItems(
  tx: Transaction,
  familyId: string,
  months: string[],
): Promise<ItemInput[]> {
  const rows = (
    await tx.query<{
      id: string;
      purpose: ItemInput["purpose"];
      planned_cents: string | null;
      paid_cents: string | null;
      status: ItemInput["status"];
      due_date: string | null;
      paid_date: string | null;
      derived: boolean;
      event_covered: boolean | null;
    }>(
      `SELECT m.id,m.purpose,m.planned_cents::text,m.paid_cents::text,m.status,
        m.due_date::text,m.paid_date::text,m.derived,
        CASE WHEN m.event_id IS NULL THEN NULL
          ELSE EXISTS(SELECT 1 FROM bank_transactions bt
            WHERE bt.household_id=m.household_id AND bt.event_id=m.event_id
              AND ${settledSql("bt")}) END AS event_covered
       FROM monthly_items m
       WHERE m.household_id=$1 AND NOT m.archived AND m.currency='BRL'
         AND to_char(m.month,'YYYY-MM')=ANY($2)`,
      [familyId, months],
    )
  ).rows;
  // Despesa de série em conta de cartão é a mesma obrigação da fatura: passa ao
  // caminho do cartão (reconcileCardPlan) só aqui; monthly_items.purpose não muda.
  const seriesContexts = await loadSeriesContexts(
    tx,
    familyId,
    rows.filter((r) => r.purpose === "expense").map((r) => r.id),
  );
  const bankCover = await readBankCover(tx, familyId, months);
  return rows.map((r) => ({
    id: r.id,
    purpose:
      r.purpose === "expense" && seriesContexts.get(r.id)?.card === true
        ? "card"
        : r.purpose,
    planned: r.planned_cents === null ? null : BigInt(r.planned_cents),
    paid: r.paid_cents === null ? null : BigInt(r.paid_cents),
    status: r.status,
    due: r.due_date,
    paidDate: r.paid_date,
    derived: r.derived,
    eventCovered: r.event_covered,
    bankCovered: bankCover.has(r.id),
  }));
}

// Recebimentos previstos (ocorrências de entrada) futuros/pendentes -> ReceiptInput[].
// detected = já casado com movimento do banco (match_state='detected'); reconcile
// ignora os detectados. windowEnd fecha a janela da regra de quinto dia útil.
export async function readReceipts(
  tx: Transaction,
  familyId: string,
  today: string,
): Promise<ReceiptInput[]> {
  const rows = (
    await tx.query<{
      id: string;
      expected_date: string;
      window_end: string | null;
      detected: boolean;
      expected_cents: string;
    }>(
      `SELECT o.id,o.expected_date::text,o.match_state='detected' AS detected,r.expected_cents::text,
        CASE WHEN r.date_rule='fifth_business_day'
          THEN (o.expected_date+interval '2 days')::date::text ELSE NULL END AS window_end
       FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
       WHERE o.household_id=$1 AND r.purpose='income' AND NOT r.paused AND NOT i.archived
         AND (o.match_state<>'detected' AND o.expected_date>=$2::date-interval '7 days')`,
      [familyId, today],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    cents: BigInt(r.expected_cents),
    expected: r.expected_date,
    windowEnd: r.window_end,
    detected: r.detected,
  }));
}

// Saídas agendadas (bank_transactions PENDING de saída) em contas incluídas no
// caixa -> ScheduledInput[]. coverage: data > snapshotDate -> not_covered (o
// saldo lido é anterior ao débito, logo ainda não refletido); senão unknown
// (pode já ter saído sem o snapshot capturar).
export async function readScheduled(
  tx: Transaction,
  familyId: string,
  snapshotDate: string | null,
  today: string,
): Promise<ScheduledInput[]> {
  const rows = (
    await tx.query<{
      id: string;
      amount_cents: string;
      transaction_date: string;
    }>(
      `SELECT t.id,t.amount_cents::text,t.transaction_date::text
       FROM bank_transactions t JOIN accounts a ON a.id=t.local_account_id
       WHERE t.household_id=$1 AND ${includedInCashSql("a")} AND a.kind<>'card'
         AND t.status='pending' AND t.event_id IS NULL
         AND NOT t.changed AND NOT t.missing
         AND ${scheduledSql("t", "$2::date")} AND t.amount_cents<0`,
      [familyId, today],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    cents: -BigInt(r.amount_cents),
    date: r.transaction_date,
    coverage:
      snapshotDate !== null && r.transaction_date > snapshotDate
        ? "not_covered"
        : "unknown",
  }));
}
