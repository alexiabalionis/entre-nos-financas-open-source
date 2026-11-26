export type ReserveMovement = {
  kind: "deposit" | "withdrawal";
  cents: bigint;
  bank_transaction_id: string | null;
  voided: boolean;
};
export type CycleStatus =
  "not_planned" | "skipped" | "planned" | "partial" | "done";

export function goalBalance(movements: ReserveMovement[]): {
  saved: bigint;
  verified: bigint;
  declared: bigint;
} {
  let verified = 0n;
  let declared = 0n;
  for (const m of movements) {
    if (m.voided) continue;
    const signed = m.kind === "deposit" ? m.cents : -m.cents;
    if (m.bank_transaction_id) verified += signed;
    else declared += signed;
  }
  return { saved: verified + declared, verified, declared };
}

export function planProgress(
  plan: { planned_cents: bigint },
  movements: ReserveMovement[],
): { planned: bigint; separated: bigint; remaining: bigint } {
  const separated = movements
    .filter((m) => !m.voided && m.kind === "deposit")
    .reduce((sum, m) => sum + m.cents, 0n);
  const left = plan.planned_cents - separated;
  return {
    planned: plan.planned_cents,
    separated,
    remaining: left > 0n ? left : 0n,
  };
}

export function cycleStatus(input: {
  plan: { planned_cents: bigint } | null;
  movements: ReserveMovement[];
}): CycleStatus {
  if (!input.plan) return "not_planned";
  if (input.plan.planned_cents === 0n) return "skipped";
  const { separated, remaining } = planProgress(input.plan, input.movements);
  if (separated === 0n) return "planned";
  return remaining === 0n ? "done" : "partial";
}
