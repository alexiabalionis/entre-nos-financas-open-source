import {
  monthsBetween,
  neededMonthly,
  type FutureInput,
} from "./future-months.ts";

export type GoalNeedFact = {
  name: string;
  target_cents: string;
  saved_cents: string;
  deadline_month: string;
  months_left: number;
  needed_monthly_cents: string | null;
  reached: boolean;
  overdue: boolean;
  is_a_projection_not_a_promise: true;
};

// Fato F1: quanto guardar por mês em cada objetivo ativo com prazo. Usa só
// neededMonthly; meta atingida e prazo vencido não podem ficar ambos em "0".
export function buildGoalNeedFacts(input: FutureInput): GoalNeedFact[] {
  return input.goals.flatMap((g) => {
    if (g.status !== "active" || g.deadlineMonth === null) return [];
    const months = monthsBetween(input.startMonth, g.deadlineMonth);
    const reached = g.target <= g.saved;
    const overdue = !reached && months <= 0;
    return [
      {
        name: g.name,
        target_cents: g.target.toString(),
        saved_cents: g.saved.toString(),
        deadline_month: g.deadlineMonth,
        months_left: months,
        needed_monthly_cents: overdue
          ? null
          : neededMonthly(g.target, g.saved, months).toString(),
        reached,
        overdue,
        is_a_projection_not_a_promise: true as const,
      },
    ];
  });
}
