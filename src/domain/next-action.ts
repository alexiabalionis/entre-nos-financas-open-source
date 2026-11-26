import type { ConfidenceState, Gap } from "./projection-confidence.ts";
import type { MoneyStatus } from "./reserve-suggestion.ts";
import type { CycleStatus } from "./reserve.ts";

export type Obligation = { id: string; amount: bigint };
export type Overspent = { category: string; over: bigint };
export type ReceiptRef = { id: string; expectedDate: string };

export type NextActionInput = {
  state: ConfidenceState;
  gaps: readonly Gap[];
  status: MoneyStatus;
  overdue: readonly Obligation[];
  overspent: readonly Overspent[];
  receiptLate: ReceiptRef | null;
  plan: { remaining: bigint; plan_date: string } | null;
  cycle: CycleStatus;
  incomeDetected: boolean;
  suggestion: bigint;
  capacity: bigint | null;
  today: string;
  until: string;
  declaredPending: boolean;
};

export type NextAction =
  | { kind: "need_data"; gap: Gap | null }
  | { kind: "overdue"; item: Obligation }
  | {
      kind: "short";
      missing: bigint | null;
      until: string;
      overspent: Overspent[];
      canPausePlan: boolean;
    }
  | { kind: "income_late"; receipt: ReceiptRef }
  | { kind: "separate"; remaining: bigint; declaredPending: boolean }
  | { kind: "decide"; suggestion: bigint; capacity: bigint | null }
  | { kind: "ok"; livre: bigint | null; until: string };

const PREFIXES = ["saldo:", "income:", "everyday:sem-historico", "bill:"];

function gapPriority(key: string): number {
  const i = PREFIXES.findIndex((p) => key.startsWith(p));
  return i === -1 ? PREFIXES.length : i;
}

function topUnboundedGap(gaps: readonly Gap[]): Gap | null {
  let best: Gap | null = null;
  for (const gap of gaps) {
    if (gap.impact !== "unbounded") continue;
    if (best === null || gapPriority(gap.key) < gapPriority(best.key)) {
      best = gap;
    }
  }
  return best;
}

function largest(items: readonly Obligation[]): Obligation {
  return items.reduce((a, b) => (b.amount > a.amount ? b : a));
}

export function nextAction(input: NextActionInput): NextAction {
  if (input.state === "INDETERMINADO") {
    return { kind: "need_data", gap: topUnboundedGap(input.gaps) };
  }
  if (input.overdue.length > 0) {
    return { kind: "overdue", item: largest(input.overdue) };
  }
  const { status, plan } = input;
  if (
    status.kind === "short" ||
    input.state === "SEM_FOLGA" ||
    input.state === "DEPENDE_DE_DADOS"
  ) {
    return {
      kind: "short",
      missing: status.kind === "short" ? status.missing : null,
      until: input.until,
      overspent: input.overspent.slice(0, 3),
      canPausePlan: plan !== null && plan.remaining > 0n,
    };
  }
  if (input.receiptLate !== null) {
    return { kind: "income_late", receipt: input.receiptLate };
  }
  if (plan !== null && plan.remaining > 0n && plan.plan_date <= input.today) {
    return {
      kind: "separate",
      remaining: plan.remaining,
      declaredPending: input.declaredPending,
    };
  }
  if (
    input.incomeDetected &&
    input.cycle === "not_planned" &&
    input.suggestion >= 1000n
  ) {
    return {
      kind: "decide",
      suggestion: input.suggestion,
      capacity: input.capacity,
    };
  }
  return {
    kind: "ok",
    livre: status.kind === "free" ? status.livre : null,
    until: input.until,
  };
}
