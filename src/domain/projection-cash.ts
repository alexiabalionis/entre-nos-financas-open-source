import { dateOnly } from "./finance.ts";
import type { Day } from "./projection.ts";
import {
  inFlow,
  outFlow,
  type ReconciledFlow,
} from "./projection-reconcile-shared.ts";

export type ScheduledInput = {
  id: string;
  cents: bigint;
  date: Day;
  coverage: "covered" | "not_covered" | "unknown";
};

export type ReceiptInput = {
  id: string;
  cents: bigint;
  expected: Day;
  windowEnd: Day | null;
  detected: boolean;
};

// Regra 4: saídas agendadas avulsas (PIX/débito pendente).
export function reconcileScheduled(
  item: ScheduledInput,
  today: Day,
): ReconciledFlow[] {
  const date = dateOnly(item.date);
  const key = `sched:${item.id}`;
  const source = key;
  if (item.coverage === "covered") return [];
  if (item.coverage === "not_covered") {
    return [
      outFlow(
        key,
        date,
        item.cents,
        date,
        item.cents,
        "scheduled",
        [source],
        "Saída agendada, ainda não refletida no saldo.",
        true,
      ),
    ];
  }
  // unknown: nom 0 na data; cons cheio em today; inicia e reduz D.
  return [
    outFlow(
      key,
      date,
      0n,
      today,
      item.cents,
      "inconsistent",
      [source],
      "Saída agendada sem cobertura confirmada; pode já ter saído.",
      true,
    ),
  ];
}

// Regra 5: recebimentos previstos (entrada).
export function reconcileReceipt(
  item: ReceiptInput,
  today: Day,
  strictToday = false,
): ReconciledFlow[] {
  if (item.detected) return [];
  const expected = dateOnly(item.expected);
  const key = `inc:${item.id}`;
  const source = key;
  const late = expected < today;
  // strictToday (só Copiloto): previsto para hoje sem janela e não detectado
  // ainda pode não ter caído, então não conta no cons (igual ao atrasado).
  if (late || (strictToday && expected === today && item.windowEnd === null)) {
    // Nom entra em today com o valor, cons entra em today com 0.
    return [
      inFlow(
        key,
        today,
        item.cents,
        today,
        0n,
        "inconsistent",
        [source],
        late
          ? "Recebimento previsto atrasado; ainda não detectado."
          : "Recebimento previsto para hoje; ainda não detectado.",
      ),
    ];
  }
  const consDate =
    item.windowEnd !== null ? dateOnly(item.windowEnd) : expected;
  return [
    inFlow(
      key,
      expected,
      item.cents,
      consDate,
      item.cents,
      "scheduled",
      [source],
      "Recebimento previsto.",
    ),
  ];
}
