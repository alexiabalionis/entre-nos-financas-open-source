import { goalBalance, planProgress } from "./reserve.ts";
import {
  laterDay,
  outFlow,
  type ReconciledFlow,
} from "./projection-reconcile-shared.ts";
import type { Day } from "./projection.ts";

// Reserva no motor de projeção (puro). O plano do mês vira dinheiro protegido
// (fluxo de saída); o que já foi separado na própria conta vira colchão; o que
// foi separado em outro lugar só vira saída enquanto o banco não o mostra.

export type ReserveGoalInput = {
  id: string;
  name: string;
  status: "active" | "paused" | "done" | "archived";
  location: "same_account" | "elsewhere" | null;
};

export type ReservePlanInput = {
  id: string;
  goalId: string;
  planned: bigint;
  planDate: Day;
};

export type ReserveMovementInput = {
  id: string;
  goalId: string;
  planId: string | null;
  kind: "deposit" | "withdrawal";
  cents: bigint;
  date: Day;
  bankTransactionId: string | null;
  voided: boolean;
};

export type ReserveInput = {
  goals: ReserveGoalInput[];
  plans: ReservePlanInput[];
  movements: ReserveMovementInput[];
};

const toMovement = (m: ReserveMovementInput) => ({
  kind: m.kind,
  cents: m.cents,
  bank_transaction_id: m.bankTransactionId,
  voided: m.voided,
});

// Dinheiro separado na própria conta continua no saldo: entra no colchão para
// não aparecer como livre.
export function reserveCushion(input: ReserveInput): bigint {
  let total = 0n;
  for (const goal of input.goals) {
    if (goal.location !== "same_account") continue;
    const { saved } = goalBalance(
      input.movements.filter((m) => m.goalId === goal.id).map(toMovement),
    );
    if (saved > 0n) total += saved;
  }
  return total;
}

export function reconcileReserve(
  p: { today: Day; snapshotDate: Day },
  input: ReserveInput,
): ReconciledFlow[] {
  const goals = new Map(input.goals.map((g) => [g.id, g]));
  const flows: ReconciledFlow[] = [];

  for (const plan of input.plans) {
    const goal = goals.get(plan.goalId);
    if (!goal || (goal.status !== "active" && goal.status !== "paused"))
      continue;
    const deposits = input.movements
      .filter((m) => m.planId === plan.id)
      .map(toMovement);
    const { remaining } = planProgress({ planned_cents: plan.planned }, deposits);
    if (remaining <= 0n) continue;
    const date = laterDay(plan.planDate, p.today);
    flows.push(
      outFlow(
        `reserve:${plan.id}`,
        date,
        remaining,
        date,
        remaining,
        "planned",
        [`reserve_plan:${plan.id}`],
        "Reserva planejada para o mês, ainda não separada.",
      ),
    );
  }

  for (const m of input.movements) {
    const goal = goals.get(m.goalId);
    if (!goal || goal.location !== "elsewhere") continue;
    if (m.voided || m.kind !== "deposit" || m.bankTransactionId !== null)
      continue;
    if (m.date < p.snapshotDate) continue;
    flows.push(
      outFlow(
        `resdecl:${m.id}`,
        p.today,
        0n,
        p.today,
        m.cents,
        "inconsistent",
        [`reserve_movement:${m.id}`],
        "Reserva informada, ainda sem extrato do banco.",
      ),
    );
  }
  return flows;
}
