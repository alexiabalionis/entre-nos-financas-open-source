import type { Transaction } from "@electric-sql/pglite";
import type {
  ReserveGoalInput,
  ReserveInput,
  ReserveMovementInput,
  ReservePlanInput,
} from "../domain/projection-reserve.ts";

// Leitura da reserva para o motor: objetivos, planos vigentes dos meses do
// horizonte e todos os movimentos. Só leitura, por família (RLS + household_id).

export type ReserveRead = ReserveInput & {
  names: { labelByKey: Map<string, string>; categoryByKey: Map<string, string> };
};

export async function readReserve(
  tx: Transaction,
  p: { familyId: string; months: string[] },
): Promise<ReserveRead> {
  const [goalRows, planRows, moveRows] = await Promise.all([
    tx.query<ReserveGoalInput>(
      "SELECT id,name,status,location FROM goals WHERE household_id=$1",
      [p.familyId],
    ),
    tx.query<{
      id: string;
      goal_id: string;
      planned_cents: string;
      plan_date: string;
    }>(
      `SELECT id,goal_id,planned_cents::text,plan_date::text FROM reserve_plans
       WHERE household_id=$1 AND superseded_by IS NULL
         AND to_char(month,'YYYY-MM')=ANY($2)`,
      [p.familyId, p.months],
    ),
    tx.query<{
      id: string;
      goal_id: string;
      plan_id: string | null;
      kind: "deposit" | "withdrawal";
      cents: string;
      date: string;
      bank_transaction_id: string | null;
      voided: boolean;
    }>(
      `SELECT id,goal_id,plan_id,kind,cents::text,date::text,bank_transaction_id,
        voided_at IS NOT NULL AS voided
       FROM reserve_movements WHERE household_id=$1`,
      [p.familyId],
    ),
  ]);
  const goals = goalRows.rows;
  const plans: ReservePlanInput[] = planRows.rows.map((r) => ({
    id: r.id,
    goalId: r.goal_id,
    planned: BigInt(r.planned_cents),
    planDate: r.plan_date,
  }));
  const movements: ReserveMovementInput[] = moveRows.rows.map((r) => ({
    id: r.id,
    goalId: r.goal_id,
    planId: r.plan_id,
    kind: r.kind,
    cents: BigInt(r.cents),
    date: r.date,
    bankTransactionId: r.bank_transaction_id,
    voided: r.voided,
  }));
  const goalName = new Map(goals.map((g) => [g.id, g.name]));
  const labelByKey = new Map<string, string>();
  const categoryByKey = new Map<string, string>();
  for (const plan of plans) {
    const key = `reserve:${plan.id}`;
    labelByKey.set(key, `Reserva: ${goalName.get(plan.goalId) ?? ""}`.trim());
    categoryByKey.set(key, "Reserva");
  }
  for (const m of movements) {
    const key = `resdecl:${m.id}`;
    labelByKey.set(
      key,
      `Reserva informada: ${goalName.get(m.goalId) ?? ""}`.trim(),
    );
    categoryByKey.set(key, "Reserva");
  }
  return { goals, plans, movements, names: { labelByKey, categoryByKey } };
}
