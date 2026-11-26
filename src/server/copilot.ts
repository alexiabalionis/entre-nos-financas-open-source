import type { Transaction } from "@electric-sql/pglite";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { readProjection } from "./projection.ts";
import { listGoals, loadMovements } from "./reserves.ts";
import {
  readIncomeFlags,
  readOverdue,
  readSpendProfile,
  type OverdueItem,
} from "./copilot-reads.ts";
import { nextAction, type NextAction } from "../domain/next-action.ts";
import type { Overspent } from "../domain/next-action.ts";
import {
  firstTarget,
  immediateCapacity,
  moneyStatus,
  suggestAmount,
  type MoneyStatus,
} from "../domain/reserve-suggestion.ts";
import {
  cycleStatus,
  goalBalance,
  planProgress,
  type CycleStatus,
} from "../domain/reserve.ts";
import type { ConfidenceState } from "../domain/projection-confidence.ts";
import {
  breakdown,
  weeks,
  type Breakdown,
  type Week,
} from "../domain/copilot-breakdown.ts";

type Plan = {
  id: string;
  planned: bigint;
  separated: bigint;
  remaining: bigint;
  plan_date: string;
  // Valor do plano que este substituiu no mês (pausa/mudança), para voltar.
  previous: bigint | null;
};
type CopilotGoal = {
  id: string;
  name: string;
  saved: bigint;
  verified: bigint;
  declared: bigint;
  location: "same_account" | "elsewhere" | null;
  version: number;
  plan: Plan | null;
  cycle: CycleStatus;
};
export type Copilot = {
  today: string;
  until: string;
  state: ConfidenceState;
  status: MoneyStatus;
  livre: bigint;
  margin: bigint;
  capacity: bigint | null;
  suggestion: bigint;
  target: bigint;
  goal: CopilotGoal | null;
  action: NextAction;
  overspent: Overspent[];
  overdue: OverdueItem[];
  // Ritmo de sempre do dia a dia (só referência; null sem histórico).
  usualWeekly: bigint | null;
  // A margem foi escolhida pela pessoa (false = padrão de meia semana).
  marginChosen: boolean;
  daysLeft: number;
  breakdown: Breakdown;
  weeks: Week[];
};

export type Wire<T> = T extends bigint
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export type CopilotWire = Wire<Copilot>;

function stringify(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringify);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stringify(v)]),
    );
  return value;
}
export function toCopilotWire(copilot: Copilot): CopilotWire {
  return stringify(copilot) as CopilotWire;
}

async function readCurrentPlan(
  tx: Transaction,
  p: { familyId: string; goalId: string; today: string },
) {
  const row = (
    await tx.query<{
      id: string;
      planned_cents: string;
      plan_date: string;
      previous_cents: string | null;
    }>(
      `SELECT c.id,c.planned_cents::text,c.plan_date::text,o.planned_cents::text AS previous_cents
       FROM reserve_plans c
       LEFT JOIN reserve_plans o ON o.superseded_by=c.id AND o.household_id=c.household_id
       WHERE c.household_id=$1 AND c.goal_id=$2 AND c.month=$3 AND c.superseded_by IS NULL`,
      [p.familyId, p.goalId, p.today.slice(0, 7) + "-01"],
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        planned_cents: BigInt(row.planned_cents),
        plan_date: row.plan_date,
        previous: row.previous_cents === null ? null : BigInt(row.previous_cents),
      }
    : null;
}

export async function readCopilot(
  db: Database,
  user: Identity,
  opts: { today?: string } = {},
): Promise<Copilot> {
  const report = await readProjection(db, user, { ...opts, copilot: true });
  const { today, cushion } = report;
  const { usualWeekly, margin, marginChosen, reserveOnAccount } =
    report.copilot!;
  // Dias até a véspera do salário, contando hoje.
  const daysLeft = dayDiff(today, report.horizonEnd) + 1;
  const usualSpend =
    usualWeekly === null ? null : (usualWeekly * BigInt(daysLeft)) / 7n;
  const activeGoals = (await listGoals(db, user)).filter(
    (g) => g.status === "active",
  );
  const scope = { familyId: user.familyId, today };

  const extra = await asUser(db, user.userId, async (tx) => {
    // Um objetivo por vez, na ordem de prioridade (listGoals já ordena): o
    // ciclo deste mês de cada um, pra achar o primeiro que ainda precisa de
    // uma decisão (not_planned) ou de separar o que já foi combinado
    // (planned/partial). Sequencial (não Promise.all) — mesma transação.
    const cycles: {
      goal: (typeof activeGoals)[number];
      movements: Awaited<ReturnType<typeof loadMovements>>;
      plan: Plan | null;
      cycle: CycleStatus;
    }[] = [];
    for (const g of activeGoals) {
      const movements = await loadMovements(tx, user.familyId, g.id);
      const current = await readCurrentPlan(tx, { ...scope, goalId: g.id });
      const plan: Plan | null = current
        ? {
            id: current.id,
            ...planProgress(current, movements),
            plan_date: current.plan_date,
            previous: current.previous,
          }
        : null;
      cycles.push({
        goal: g,
        movements,
        plan,
        cycle: cycleStatus({ plan: current, movements }),
      });
    }
    const spotlight =
      cycles.find((c) => c.cycle !== "skipped" && c.cycle !== "done") ??
      cycles[0] ??
      null;
    return {
      income: await readIncomeFlags(tx, scope),
      overdue: await readOverdue(tx, scope),
      spend: await readSpendProfile(tx, scope),
      spotlight,
    };
  });
  const { income, overdue, spend, spotlight } = extra;
  const active = spotlight?.goal ?? null;
  const movements = spotlight?.movements ?? [];
  const plan = spotlight?.plan ?? null;
  const cycle: CycleStatus = spotlight?.cycle ?? "not_planned";

  const balance = goalBalance(movements);

  const livre = report.shown ?? report.low.cons.cents - cushion;
  const status = moneyStatus({ livre, margin });
  const capacity = immediateCapacity({
    state: report.state,
    shown: report.shown,
    incomeDetected: income.incomeDetected,
    receiptDueUndetected: income.receiptLate !== null,
  });
  const target = active
    ? BigInt(active.target_cents)
    : firstTarget({ weeklyTypical: usualWeekly });
  const suggestion = suggestAmount({
    capacity,
    saved: balance.saved,
    target,
    usualSpend,
  });

  const action = nextAction({
    state: report.state,
    gaps: report.gaps,
    status,
    overdue,
    overspent: spend.overspent,
    receiptLate: income.receiptLate,
    plan: plan && { remaining: plan.remaining, plan_date: plan.plan_date },
    cycle,
    incomeDetected: income.incomeDetected,
    suggestion,
    capacity,
    today,
    until: report.horizonEnd,
    declaredPending: balance.declared > 0n,
  });

  return {
    today,
    until: report.horizonEnd,
    state: report.state,
    status,
    livre,
    margin,
    capacity,
    suggestion,
    target,
    goal: active
      ? {
          id: active.id,
          name: active.name,
          ...balance,
          location: active.location as CopilotGoal["location"],
          version: active.version,
          plan,
          cycle,
        }
      : null,
    action,
    overspent: spend.overspent,
    overdue,
    usualWeekly,
    marginChosen,
    daysLeft,
    breakdown: breakdown({
      today,
      sConf: report.sConf,
      flows: report.flows,
      low: report.low.cons,
      margin,
      reserveOnAccount,
    }),
    weeks: weeks({ today, until: report.horizonEnd, flows: report.flows }),
  };
}

function dayDiff(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) /
      86_400_000,
  );
}
