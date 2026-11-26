import { dateOnly } from "./finance.ts";
import type { Day } from "./projection.ts";
import {
  max,
  outFlow,
  type Quality,
  type ReconciledFlow,
} from "./projection-reconcile-shared.ts";

export type BillPayment = {
  id: string;
  cents: bigint;
  date: Day;
  covered: boolean;
};

export type BillInput = {
  card: string;
  dueMonth: string;
  due: Day;
  bankTotal: bigint | null;
  bankClosed: boolean;
  needsReview: boolean;
  manual: { amount: bigint; paid: boolean } | null;
  estimate: bigint;
  payments: BillPayment[];
};

// Regra 3: fatura de cartão. Deriva (nom, cons) antes dos pagamentos, depois
// abate pagamentos covered e agenda os não-covered futuros.
export function reconcileBill(bill: BillInput, today: Day): ReconciledFlow[] {
  const due = dateOnly(bill.due);
  const key = `bill:${bill.card}:${bill.dueMonth}`;
  const source = key;
  const manualAmount = bill.manual?.amount ?? 0n;

  // manual.paid => obrigação quitada manualmente, sem fluxo.
  if (bill.manual?.paid) return [];

  // Valor da fatura ANTES dos pagamentos.
  let nomBase: bigint;
  let consBase: bigint;
  let quality: Quality;
  if (bill.needsReview && bill.bankTotal === null) {
    nomBase = bill.estimate;
    consBase = max(bill.estimate, manualAmount);
    quality = "inconsistent";
  } else if (bill.bankClosed && bill.bankTotal !== null && !bill.needsReview) {
    nomBase = bill.bankTotal;
    consBase = bill.bankTotal;
    quality = "confirmed";
  } else if (bill.bankTotal !== null) {
    // Aberta com banco.
    nomBase = max(bill.bankTotal, bill.estimate);
    consBase = max(nomBase, manualAmount);
    quality = "estimated";
  } else if (bill.manual !== null) {
    // Só manual.
    nomBase = manualAmount;
    consBase = max(manualAmount, bill.estimate);
    quality = "planned";
  } else {
    // Nenhum.
    nomBase = bill.estimate;
    consBase = bill.estimate;
    quality = "estimated";
  }

  // Pagamentos covered abatem o restante (nom e cons separados, nunca abaixo de 0).
  let coveredSum = 0n;
  const scheduledPayments: BillPayment[] = [];
  for (const payment of bill.payments) {
    if (payment.covered) {
      coveredSum += payment.cents;
    } else if (dateOnly(payment.date) >= today) {
      // Pagamento não refletido ainda, com data futura: AGENDADO.
      scheduledPayments.push(payment);
    }
    // Não covered e vencido: sem evento e sem agendamento conhecido; o valor
    // continua no restante da fatura (cai no fluxo do vencimento).
  }

  let nomRemaining = max(nomBase - coveredSum, 0n);
  let consRemaining = max(consBase - coveredSum, 0n);

  const flows: ReconciledFlow[] = [];

  // Agendados: cada um sai na sua data por min(cents, restante), sem somar acima
  // do restante. Ordenados por data e id para determinismo.
  const ordered = [...scheduledPayments].sort((a, b) =>
    a.date === b.date
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.date < b.date
        ? -1
        : 1,
  );
  for (const payment of ordered) {
    const nomTake = payment.cents < nomRemaining ? payment.cents : nomRemaining;
    const consTake =
      payment.cents < consRemaining ? payment.cents : consRemaining;
    if (nomTake <= 0n && consTake <= 0n) continue;
    flows.push(
      outFlow(
        `${key}:sched:${payment.id}`,
        dateOnly(payment.date),
        nomTake,
        dateOnly(payment.date),
        consTake,
        quality,
        [source],
        "Pagamento de fatura agendado.",
        true,
      ),
    );
    nomRemaining -= nomTake;
    consRemaining -= consTake;
  }

  // Restante da fatura no vencimento.
  if (nomRemaining > 0n || consRemaining > 0n) {
    flows.push(
      outFlow(
        key,
        due,
        nomRemaining,
        due,
        consRemaining,
        quality,
        [source],
        "Fatura de cartão a pagar no vencimento.",
      ),
    );
  }
  return flows;
}
