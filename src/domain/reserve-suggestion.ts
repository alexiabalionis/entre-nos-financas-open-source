import type { ConfidenceState } from "./projection-confidence.ts";

const MIN_CAPACITY = 2000n;
const ROUND_STEP = 1000n;
const TARGET_STEP = 5000n;
const TARGET_MIN = 10000n;
const TARGET_DEFAULT = 50000n;

export type MoneyStatus =
  | { kind: "free"; livre: bigint }
  | { kind: "zero" }
  | { kind: "margin"; used: bigint }
  | { kind: "short"; missing: bigint };

export function immediateCapacity(input: {
  state: ConfidenceState;
  shown: bigint | null;
  incomeDetected: boolean;
  receiptDueUndetected: boolean;
}): bigint | null {
  const firm = input.state === "CONFIRMADO" || input.state === "COM_RESSALVA";
  if (!firm || input.shown === null) return null;
  if (!input.incomeDetected || input.receiptDueUndetected) return null;
  return input.shown;
}

// Sugestão pelo hábito: o que sobra do livre depois do dia a dia de sempre
// até o salário (usualSpend), sem passar do que falta para a meta. Sem
// histórico de dia a dia, metade do livre.
export function suggestAmount(input: {
  capacity: bigint | null;
  saved: bigint;
  target: bigint;
  usualSpend: bigint | null;
}): bigint {
  if (input.capacity === null || input.capacity < MIN_CAPACITY) return 0n;
  const left =
    input.usualSpend === null
      ? input.capacity / 2n
      : input.capacity - input.usualSpend;
  const room = input.target - input.saved;
  const raw = left < room ? left : room;
  if (raw <= 0n) return 0n;
  const rounded = (raw / ROUND_STEP) * ROUND_STEP;
  return rounded < ROUND_STEP ? 0n : rounded;
}

export function firstTarget(input: { weeklyTypical: bigint | null }): bigint {
  if (input.weeklyTypical === null) return TARGET_DEFAULT;
  const double = input.weeklyTypical * 2n;
  const up = ((double + TARGET_STEP - 1n) / TARGET_STEP) * TARGET_STEP;
  return up < TARGET_MIN ? TARGET_MIN : up;
}

export function livreWith(input: {
  shown: bigint;
  remaining: bigint;
  separated: bigint;
  planned: bigint;
}): bigint {
  const gap = input.planned - input.separated;
  return input.shown + input.remaining - (gap > 0n ? gap : 0n);
}

export function moneyStatus(input: {
  livre: bigint;
  margin: bigint;
}): MoneyStatus {
  const { livre, margin } = input;
  if (livre >= ROUND_STEP) return { kind: "free", livre };
  if (livre >= 0n) return { kind: "zero" };
  if (-margin <= livre) return { kind: "margin", used: -livre };
  return { kind: "short", missing: -(livre + margin) };
}
