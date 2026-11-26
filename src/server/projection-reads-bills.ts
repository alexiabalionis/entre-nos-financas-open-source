import type { Transaction } from "@electric-sql/pglite";
import { normalize } from "../domain/finance.ts";
import { billForDueMonth } from "../domain/card-competence.ts";
import { billPayment } from "../domain/bank-analysis.ts";
import {
  deriveInstallments,
  type InstallmentLine,
  type InstallmentSeries,
  stripInstallmentMarker,
} from "../domain/projection-installments.ts";
import type { BillInput, BillPayment } from "../domain/projection-bills.ts";
import {
  CARD_LOOKBACK_MONTHS,
  competenceOf,
  type CardCompetenceContext,
} from "./card-competence.ts";

// F1a do Copiloto (leituras de fatura): faturas por cartão e mês de vencimento,
// a estimativa do ciclo em aberto e as parcelas futuras derivadas. A competência
// de cartão é sempre a do núcleo (card-competence), nunca reimplementada. Toda
// leitura é por família (RLS cuida do escopo); nada aqui registra lançamento.

type RawBill = {
  bank_account_id: string;
  local_account_id: string;
  remote_id: string;
  due_date: string;
  close_date: string | null;
  total_cents: string | null;
  needs_review: boolean;
  payments: { id?: string; cents?: string; date?: string; covered?: boolean }[];
};
type ManualBill = {
  account_id: string;
  month: string;
  amount_cents: string;
  due_date: string;
  paid: boolean;
};

// Faturas por cartão e mês de vencimento -> BillInput[]. Fonte do banco
// (bank_card_bills: total, needs_review, payments), manual (manual_card_bills) e
// a estimativa (compras do ciclo que caem no mês + parcelas derivadas). A
// estimativa cobre meses sem fatura lida. due = vencimento do banco quando há;
// senão o do ciclo (billForDueMonth); senão o manual.
export async function readBills(
  tx: Transaction,
  familyId: string,
  competence: CardCompetenceContext,
  months: string[],
): Promise<BillInput[]> {
  return (await readBillsDetailed(tx, familyId, competence, months)).bills;
}

// Linha de parcela observada, com a descrição original e o mês de competência.
export type ObservedInstallment = InstallmentLine & {
  description: string;
  month: string | null;
};
export type BillsDetail = {
  bills: BillInput[];
  /** Séries de parcelamento derivadas (as mesmas que somam na estimativa). */
  series: InstallmentSeries[];
  /** Todas as parcelas observadas na janela, com competência. */
  lines: ObservedInstallment[];
  /** card|YYYY-MM -> soma das parcelas derivadas (já dentro de `estimate`). */
  derivedByBill: Map<string, bigint>;
  /** card|YYYY-MM -> descrições (normalizadas) das compras que somam na estimativa. */
  estimateTexts: Map<string, string[]>;
  /** Compras avulsas (nem parcela, nem recorrente) que compõem o resto da estimativa. */
  leftoverLines: { id: string; card: string; month: string; description: string; cents: bigint }[];
};

export async function readBillsDetailed(
  tx: Transaction,
  familyId: string,
  competence: CardCompetenceContext,
  months: string[],
): Promise<BillsDetail> {
  const bankBills = (
    await tx.query<RawBill>(
      `SELECT b.bank_account_id,ba.local_account_id,b.remote_id::text,b.due_date::text,
        b.close_date::text,b.total_cents::text,b.needs_review,b.payments
       FROM bank_card_bills b JOIN bank_accounts ba ON ba.id=b.bank_account_id
       WHERE b.household_id=$1 AND to_char(b.due_date,'YYYY-MM')=ANY($2)`,
      [familyId, months],
    )
  ).rows;
  const manualBills = (
    await tx.query<ManualBill>(
      `SELECT account_id,to_char(month,'YYYY-MM') AS month,amount_cents::text,due_date::text,paid
       FROM manual_card_bills
       WHERE household_id=$1 AND to_char(month,'YYYY-MM')=ANY($2)`,
      [familyId, months],
    )
  ).rows;
  const detail = await estimateBills(tx, familyId, competence, months);
  const estimate = detail.estimate;

  // Chave card|dueMonth para juntar banco, manual e estimativa.
  type Acc = {
    card: string;
    dueMonth: string;
    due: string;
    bankTotal: bigint | null;
    bankClosed: boolean;
    needsReview: boolean;
    manual: { amount: bigint; paid: boolean } | null;
    estimate: bigint;
    payments: BillPayment[];
  };
  const byKey = new Map<string, Acc>();
  const keyOf = (card: string, dueMonth: string) => `${card}|${dueMonth}`;
  const slot = (card: string, dueMonth: string, due: string): Acc => {
    const key = keyOf(card, dueMonth);
    let s = byKey.get(key);
    if (!s) {
      s = {
        card,
        dueMonth,
        due,
        bankTotal: null,
        bankClosed: false,
        needsReview: false,
        manual: null,
        estimate: 0n,
        payments: [],
      };
      byKey.set(key, s);
    }
    return s;
  };

  for (const b of bankBills) {
    const dueMonth = b.due_date.slice(0, 7);
    const s = slot(b.local_account_id, dueMonth, b.due_date);
    s.bankTotal = b.total_cents === null ? null : BigInt(b.total_cents);
    s.bankClosed = b.close_date !== null;
    s.needsReview = b.needs_review;
    for (const p of b.payments ?? [])
      if (p.cents !== undefined && p.date !== undefined)
        s.payments.push({
          id: p.id ?? `${b.remote_id}:${s.payments.length}`,
          cents: BigInt(p.cents),
          date: p.date,
          covered: p.covered ?? false,
        });
  }
  for (const b of manualBills) {
    const s = slot(b.account_id, b.month, b.due_date);
    s.manual = { amount: BigInt(b.amount_cents), paid: b.paid };
  }
  for (const [key, cents] of estimate) {
    const [card, dueMonth] = key.split("|");
    const existing = byKey.get(key);
    const due =
      existing?.due ??
      billForDueMonth(competence.versions.get(card) ?? [], dueMonth)?.dueDate ??
      `${dueMonth}-01`;
    slot(card, dueMonth, due).estimate += cents;
  }

  const bills = [...byKey.values()].map((s) => ({
    card: s.card,
    dueMonth: s.dueMonth,
    due: s.due,
    bankTotal: s.bankTotal,
    bankClosed: s.bankClosed,
    needsReview: s.needsReview,
    manual: s.manual,
    estimate: s.estimate,
    payments: s.payments,
  }));
  return {
    bills,
    series: detail.series,
    lines: detail.lines,
    derivedByBill: detail.derivedByBill,
    estimateTexts: detail.estimateTexts,
    leftoverLines: detail.leftoverLines,
  };
}

// Estimativa de fatura por card|dueMonth: compras do ciclo ainda não vinculadas
// a uma fatura lida, pela competência do núcleo, mais as parcelas futuras
// derivadas (deriveInstallments). Só meses pedidos.
async function estimateBills(
  tx: Transaction,
  familyId: string,
  competence: CardCompetenceContext,
  months: string[],
): Promise<{
  estimate: Map<string, bigint>;
  series: InstallmentSeries[];
  lines: ObservedInstallment[];
  derivedByBill: Map<string, bigint>;
  estimateTexts: Map<string, string[]>;
  leftoverLines: { id: string; card: string; month: string; description: string; cents: bigint }[];
}> {
  const rows = (
    await tx.query<{
      id: string;
      bank_account_id: string;
      local_account_id: string;
      transaction_date: string;
      amount_cents: string;
      operation_type: string;
      description: string;
      card_meta: {
        bill_id?: string;
        installment_number?: number;
        total_installments?: number;
        purchase_date?: string;
      };
    }>(
      `SELECT b.id,b.bank_account_id,ba.local_account_id,b.transaction_date::text,
        b.amount_cents::text,b.operation_type,b.description,b.card_meta
       FROM bank_transactions b JOIN bank_accounts ba ON ba.id=b.bank_account_id
       WHERE b.household_id=$1 AND ba.account_type='CREDIT'
         AND b.status<>'ignored'
         AND NOT b.changed AND NOT b.missing AND b.amount_cents<0
         AND coalesce(b.analysis->>'group','') NOT IN ('duplicate','history')
         AND b.transaction_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date-make_interval(months=>$2)`,
      [familyId, CARD_LOOKBACK_MONTHS],
    )
  ).rows;
  const wanted = new Set(months);
  const estimate = new Map<string, bigint>();
  const estimateTexts = new Map<string, string[]>();
  const installmentLines: InstallmentLine[] = [];
  const observed: ObservedInstallment[] = [];
  const leftoverLines: { id: string; card: string; month: string; description: string; cents: bigint }[] = [];
  for (const r of rows) {
    if (billPayment(normalize(r.description), normalize(r.operation_type)))
      continue;
    const cents = -BigInt(r.amount_cents);
    // Compra vinculada a fatura lida não entra na estimativa: o total oficial
    // da fatura (BillInput.bankTotal) já a cobre.
    const comp = competenceOf(competence, {
      account_id: r.local_account_id,
      bank_account_id: r.bank_account_id,
      transaction_date: r.transaction_date,
      card_meta: r.card_meta,
    });
    const k = r.card_meta.installment_number;
    const n = r.card_meta.total_installments;
    const isInstallment = !!(k && n && n > 1);
    if (!r.card_meta.bill_id) {
      if (comp.month && wanted.has(comp.month)) {
        const key = `${r.local_account_id}|${comp.month}`;
        estimate.set(key, (estimate.get(key) ?? 0n) + cents);
        estimateTexts.set(key, [...(estimateTexts.get(key) ?? []), normalize(r.description)]);
        // Nem parcela, nem recorrente (recorrente não passa por aqui, vem de
        // outra fonte): a compra avulsa que sobra no "resto" da fatura, pra
        // poder categorizá-la em vez de jogar tudo num "Outras compras".
        if (!isInstallment) leftoverLines.push({ id: r.id, card: r.local_account_id, month: comp.month, description: r.description, cents });
      }
    }
    if (isInstallment) {
      const line: InstallmentLine = {
        id: r.id,
        card: r.local_account_id,
        purchaseDate: r.card_meta.purchase_date ?? null,
        transactionDate: r.transaction_date,
        // Sem o "01/10" colado no nome: senão cada parcela vira uma compra.
        merchant: normalize(stripInstallmentMarker(r.description, k, n)),
        cents,
        k,
        n,
        billDueDate: null,
      };
      installmentLines.push(line);
      observed.push({ ...line, description: stripInstallmentMarker(r.description, k, n), month: comp.month });
    }
  }
  const fromMonth = months.reduce((a, b) => (a < b ? a : b), months[0]);
  const derived = deriveInstallments(
    installmentLines,
    competence.versions,
    fromMonth,
  );
  for (const [key, cents] of derived.byBill) {
    const dueMonth = key.split("|")[1];
    if (wanted.has(dueMonth))
      estimate.set(key, (estimate.get(key) ?? 0n) + cents);
  }
  return {
    estimate,
    series: derived.series,
    lines: observed,
    derivedByBill: derived.byBill,
    estimateTexts,
    leftoverLines,
  };
}
