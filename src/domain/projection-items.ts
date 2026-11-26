import { dateOnly } from "./finance.ts";
import type { Day } from "./projection.ts";
import {
  laterDay,
  max,
  outFlow,
  type ReconciledFlow,
} from "./projection-reconcile-shared.ts";

export type ItemInput = {
  id: string;
  purpose: "expense" | "card" | "saving" | "income" | "benefit";
  planned: bigint | null;
  paid: bigint | null;
  status: "open" | "partial" | "done";
  due: Day | null;
  paidDate: Day | null;
  derived: boolean;
  // evento ligado e já refletido no saldo; null = sem evento associado.
  eventCovered: boolean | null;
  // Conta fixa já paga ou agendada por uma linha do banco (readBankCover): a
  // linha do banco já conta o dinheiro (saldo, agendamento ou fatura), então o
  // item não sai de novo. Mesma regra do "Ainda vai pagar".
  bankCovered: boolean;
};

// Regra 1: itens de orçamento (expense/saving). Ignora derived, benefit e
// income (receita vem de receipts). card é tratado só no agregado da regra 2.
export function reconcileItem(
  item: ItemInput,
  today: Day,
  snapshotDate: Day,
): ReconciledFlow[] {
  if (item.derived) return [];
  if (item.purpose === "benefit" || item.purpose === "income") return [];
  if (item.purpose === "card") return [];
  if (item.bankCovered) return [];

  const flows: ReconciledFlow[] = [];
  const paid = item.paid ?? 0n;
  const source = `item:${item.id}`;

  // Parte paga mas ainda NÃO refletida no saldo: já saiu da conta da pessoa mas
  // o snapshot não a capturou, então ela precisa descer o saldo projetado.
  const paidReflected =
    paid > 0n &&
    (item.eventCovered === true ||
      (item.paidDate !== null && item.paidDate < snapshotDate));
  if (paid > 0n && !paidReflected) {
    const landing =
      item.paidDate !== null ? laterDay(dateOnly(item.paidDate), today) : today;
    flows.push(
      outFlow(
        `item:${item.id}:paid`,
        landing,
        paid,
        landing,
        paid,
        "planned",
        [source],
        "Pagamento já feito ainda não refletido no saldo.",
      ),
    );
  }

  // Restante a pagar.
  const remaining =
    item.status === "done" ? 0n : max((item.planned ?? 0n) - paid, 0n);
  // planned nulo e não concluído: lacuna (F0d), não gera fluxo aqui.
  if (item.planned === null && item.status !== "done") return flows;
  if (remaining > 0n) {
    if (item.due === null) {
      flows.push(
        outFlow(
          `item:${item.id}`,
          today,
          remaining,
          today,
          remaining,
          "estimated",
          [source],
          "Despesa prevista sem data; estimada para hoje.",
        ),
      );
    } else {
      const due = dateOnly(item.due);
      flows.push(
        outFlow(
          `item:${item.id}`,
          due,
          remaining,
          due,
          remaining,
          "planned",
          [source],
          "Despesa prevista a pagar no vencimento.",
        ),
      );
    }
  }
  return flows;
}

// Regra 2: itens card NÃO viram fluxo próprio (é a mesma obrigação da fatura).
// Por mês de vencimento, se a soma dos restantes dos itens card superar a soma
// do cons das faturas daquele mês, o excedente vira um fluxo cardplan: compras
// previstas que ainda não caíram em nenhuma fatura conhecida.
export function reconcileCardPlan(
  items: ItemInput[],
  billConsByMonth: Map<string, bigint>,
  billMinDueByMonth: Map<string, Day>,
  today: Day,
): ReconciledFlow[] {
  const remainingByMonth = new Map<string, bigint>();
  const dueByMonth = new Map<string, Day>();
  const idsByMonth = new Map<string, string[]>();

  for (const item of items) {
    if (item.purpose !== "card" || item.derived || item.bankCovered) continue;
    const remaining =
      item.status === "done"
        ? 0n
        : max((item.planned ?? 0n) - (item.paid ?? 0n), 0n);
    if (remaining <= 0n) continue;
    if (item.planned === null && item.status !== "done") continue;
    const landing = item.due !== null ? dateOnly(item.due) : today;
    const month = landing.slice(0, 7);
    remainingByMonth.set(
      month,
      (remainingByMonth.get(month) ?? 0n) + remaining,
    );
    const prevDue = dueByMonth.get(month);
    if (prevDue === undefined || landing < prevDue)
      dueByMonth.set(month, landing);
    const ids = idsByMonth.get(month) ?? [];
    ids.push(`item:${item.id}`);
    idsByMonth.set(month, ids);
  }

  const months = new Set<string>([
    ...remainingByMonth.keys(),
    ...billConsByMonth.keys(),
  ]);
  const flows: ReconciledFlow[] = [];
  for (const month of months) {
    const remaining = remainingByMonth.get(month) ?? 0n;
    const billCons = billConsByMonth.get(month) ?? 0n;
    const excess = remaining - billCons;
    if (excess <= 0n) continue;
    // Data do fluxo: menor vencimento conhecido do mês (fatura ou item card).
    const itemDue = dueByMonth.get(month);
    const billDue = billMinDueByMonth.get(month);
    let date: Day;
    if (billDue !== undefined && itemDue !== undefined)
      date = billDue < itemDue ? billDue : itemDue;
    else date = billDue ?? itemDue ?? today;
    flows.push(
      outFlow(
        `cardplan:${month}`,
        date,
        0n,
        date,
        excess,
        "inconsistent",
        idsByMonth.get(month) ?? [],
        "Compras de cartão previstas acima do total das faturas conhecidas do mês.",
      ),
    );
  }
  return flows;
}
