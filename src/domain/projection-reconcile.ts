import { dateOnly } from "./finance.ts";
import { diffDays } from "./day.ts";
import type { Day } from "./projection.ts";
import type { ReconciledFlow } from "./projection-reconcile-shared.ts";
import {
  reconcileCardPlan,
  reconcileItem,
  type ItemInput,
} from "./projection-items.ts";
import { reconcileBill, type BillInput } from "./projection-bills.ts";
import {
  reconcileReceipt,
  reconcileScheduled,
  type ReceiptInput,
  type ScheduledInput,
} from "./projection-cash.ts";

// F0b do Copiloto: concilia obrigações (itens de orçamento, faturas de cartão,
// saídas agendadas e recebimentos previstos) nos fluxos que o motor de caixa
// (project) consome. Função PURA: sem I/O, sem banco, não muta o input e é
// determinística (resultado ordenado por key). A qualidade e a explicação de
// cada fluxo carregam a confiança da conciliação para a UI do Copiloto.

// API pública estável: tipos reexportados dos módulos de regra para que os
// consumidores importem tudo deste ponto de entrada.
export type { Quality, ReconciledFlow } from "./projection-reconcile-shared.ts";
export type { ItemInput } from "./projection-items.ts";
export type { BillInput } from "./projection-bills.ts";
export type { ScheduledInput, ReceiptInput } from "./projection-cash.ts";

export type ReconcileInput = {
  today: Day;
  snapshotDate: Day;
  items: ItemInput[];
  bills: BillInput[];
  scheduled: ScheduledInput[];
  receipts: ReceiptInput[];
  // Só o Copiloto: recebimento de hoje ainda não detectado não conta no cons.
  strictToday?: boolean;
};

export function reconcile(input: ReconcileInput): ReconciledFlow[] {
  const today = dateOnly(input.today);
  const snapshotDate = dateOnly(input.snapshotDate);

  const flows: ReconciledFlow[] = [];

  for (const item of input.items)
    flows.push(...reconcileItem(item, today, snapshotDate));

  // Faturas primeiro, agregando o cons por mês para a comparação da regra 2.
  const billConsByMonth = new Map<string, bigint>();
  const billMinDueByMonth = new Map<string, Day>();
  for (const bill of input.bills) {
    const billFlows = reconcileBill(bill, today);
    flows.push(...billFlows);
    // cons total da fatura (soma dos fluxos gerados por ela) por mês de due.
    const month = dateOnly(bill.due).slice(0, 7);
    const cons = billFlows.reduce((sum, f) => sum + f.cons.cents, 0n);
    billConsByMonth.set(month, (billConsByMonth.get(month) ?? 0n) + cons);
    const prevDue = billMinDueByMonth.get(month);
    const due = dateOnly(bill.due);
    if (prevDue === undefined || due < prevDue)
      billMinDueByMonth.set(month, due);
  }

  flows.push(
    ...reconcileCardPlan(
      input.items,
      billConsByMonth,
      billMinDueByMonth,
      today,
    ),
  );

  // Débito automático da fatura agendado na conta corrente: é o pagamento da
  // própria fatura, não uma saída a mais. Casa por valor exato e até 3 dias do
  // vencimento; cada fatura absorve um agendamento só.
  const billFlows = flows.filter((f) => f.key.startsWith("bill:") && !f.key.includes(":sched:"));
  const absorbed = new Set<string>();
  for (const item of input.scheduled) {
    const bill = billFlows.find(
      (f) =>
        !absorbed.has(f.key) &&
        f.cons.cents === item.cents &&
        Math.abs(diffDays(f.cons.date, dateOnly(item.date))) <= 3,
    );
    if (bill) {
      absorbed.add(bill.key);
      continue;
    }
    flows.push(...reconcileScheduled(item, today));
  }

  for (const item of input.receipts)
    flows.push(...reconcileReceipt(item, today, input.strictToday === true));

  // Determinístico: ordenar por key. Keys duplicadas são erro de domínio.
  flows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const seen = new Set<string>();
  for (const flow of flows) {
    if (seen.has(flow.key))
      throw new Error("Conciliação gerou fluxo com key duplicada.");
    seen.add(flow.key);
  }
  return flows;
}
