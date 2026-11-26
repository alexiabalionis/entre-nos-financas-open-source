import { dateOnly } from "./finance.ts";
import type { Day } from "./projection.ts";

// Uma decisão de gasto do período. `cents` é o compromisso total (inclusive o
// valor cheio de uma compra parcelada, que consome de uma vez); `planned` é a
// parte já absorvida pelo plano (não discricionária), entre 0 e `cents`. O
// discricionário é `cents - planned`. `adjustments` são estornos/ajustes
// vinculados: `cents` positivo devolve dinheiro; `linked` indica que abate o
// gasto da própria decisão (e não só devolve ao pool).
export type Decision = {
  key: string;
  day: Day;
  cents: bigint;
  planned: bigint;
  status: "active" | "cancelled";
  adjustments: { day: Day; cents: bigint; linked: boolean }[];
};

export type BehaviorInput = {
  period: { start: Day; end: Day };
  today: Day;
  // A = max(0, cCons) atual.
  A: bigint;
  // Liberado no início do período (orçamento discricionário do período).
  releaseP: bigint;
  weeklyCap: bigint | null;
  leftover: "redistribuir" | "preservar";
  // A na segunda-feira da semana corrente (E nunca depende de A atual).
  weekStartA: bigint;
  decisions: readonly Decision[];
};

export type BehaviorResult = {
  spentP: bigint;
  excessP: bigint;
  poolRem: bigint;
  week: {
    start: Day;
    end: Day;
    E: bigint;
    spent: bigint;
    remaining: bigint;
    capped: boolean;
  };
  U: bigint;
  commitmentTotal: bigint;
};

function nextDay(day: Day): Day {
  const parsed = new Date(day + "T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(start: Day, end: Day): bigint {
  let count = 0n;
  for (let day = start; day <= end; day = nextDay(day)) count += 1n;
  return count;
}

// ISO: segunda = 1 .. domingo = 7.
function isoWeekday(day: Day): number {
  const parsed = new Date(day + "T12:00:00Z").getUTCDay();
  return parsed === 0 ? 7 : parsed;
}

function mondayOf(day: Day): Day {
  const parsed = new Date(day + "T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() - (isoWeekday(day) - 1));
  return parsed.toISOString().slice(0, 10);
}

function sundayOf(monday: Day): Day {
  const parsed = new Date(monday + "T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + 6);
  return parsed.toISOString().slice(0, 10);
}

const clampLow = (value: Day, low: Day): Day => (value < low ? low : value);
const clampHigh = (value: Day, high: Day): Day => (value > high ? high : value);

function discricionary(decision: Decision): bigint {
  const diff = decision.cents - decision.planned;
  return diff > 0n ? diff : 0n;
}

/**
 * Orçamento comportamental semanal. Pura: não lê I/O nem data do sistema.
 *
 * - spentP = discricionário das decisões ativas no período, menos ajustes
 *   vinculados cujo dia caia no período (devolução de gasto).
 * - commitmentTotal = soma do `cents` das ativas no período (medida separada
 *   do discricionário; uma parcelada consome o compromisso cheio de uma vez).
 * - excessP = max(0, spentP - releaseP).
 * - poolRem = max(0, min(releaseP - spentP, A)) — o pool nunca excede o caixa.
 * - E da semana deriva só de `weekStartA` (não sobe no meio da semana se A
 *   subir): E = floor(poolAtSegunda * d_w / D_rem), com poolAtSegunda =
 *   max(0, min(releaseP - spentAntesDaSemana, weekStartA)). Se leftover for
 *   "preservar" e houver weeklyCap, E = min(E, floor(weeklyCap * d_w / 7)).
 * - remaining = max(0, min(E - spentWeek, poolRem)); capped quando poolRem é o
 *   limitante (poolRem < E - spentWeek). U = A - poolRem (folga fora do pool).
 */
export function behavior(input: BehaviorInput): BehaviorResult {
  const start = dateOnly(input.period.start);
  const end = dateOnly(input.period.end);
  if (end < start) throw new Error("Período termina antes de começar.");
  const today = dateOnly(input.today);

  const active = input.decisions.filter((d) => d.status === "active");
  for (const d of active) dateOnly(d.day);

  const inPeriod = (day: Day): boolean => day >= start && day <= end;

  // Discricionário gasto no período e ajustes vinculados devolvidos no período.
  let spentP = 0n;
  let commitmentTotal = 0n;
  for (const d of active) {
    if (inPeriod(d.day)) {
      spentP += discricionary(d);
      commitmentTotal += d.cents;
    }
    for (const a of d.adjustments)
      if (a.linked && inPeriod(dateOnly(a.day))) spentP -= a.cents;
  }

  const excessP = spentP - input.releaseP > 0n ? spentP - input.releaseP : 0n;

  const poolRaw = input.releaseP - spentP;
  const poolCapped = poolRaw < input.A ? poolRaw : input.A;
  const poolRem = poolCapped > 0n ? poolCapped : 0n;

  // Semana corrente: segunda a domingo contendo `today`, recortada ao período.
  const weekMonday = clampLow(mondayOf(today), start);
  const weekStart = clampLow(weekMonday, start);
  const weekEnd = clampHigh(sundayOf(mondayOf(today)), end);

  const dW = daysBetween(weekStart, weekEnd);
  // Dias restantes: da segunda (recortada ao período) até o fim do período.
  const dRem = daysBetween(weekStart, end);

  // Gasto discricionário antes da semana (decisões com dia < weekStart) e
  // ajustes vinculados antes da semana — define o pool disponível na segunda.
  let spentBeforeWeek = 0n;
  for (const d of active) {
    if (inPeriod(d.day) && d.day < weekStart)
      spentBeforeWeek += discricionary(d);
    for (const a of d.adjustments) {
      const day = dateOnly(a.day);
      if (a.linked && inPeriod(day) && day < weekStart)
        spentBeforeWeek -= a.cents;
    }
  }

  const poolAtMondayRaw = input.releaseP - spentBeforeWeek;
  const poolAtMondayClamped =
    poolAtMondayRaw < input.weekStartA ? poolAtMondayRaw : input.weekStartA;
  const poolAtMonday = poolAtMondayClamped > 0n ? poolAtMondayClamped : 0n;

  let E = dRem > 0n ? (poolAtMonday * dW) / dRem : 0n;
  if (input.leftover === "preservar" && input.weeklyCap !== null) {
    const capped = (input.weeklyCap * dW) / 7n;
    if (capped < E) E = capped;
  }

  // Gasto da semana: discricionário das decisões na semana, menos ajustes
  // vinculados na semana (ajuste fora da semana da compra só entra no pool).
  let spentWeek = 0n;
  for (const d of active) {
    if (d.day >= weekStart && d.day <= weekEnd) spentWeek += discricionary(d);
    for (const a of d.adjustments) {
      const day = dateOnly(a.day);
      if (a.linked && day >= weekStart && day <= weekEnd) spentWeek -= a.cents;
    }
  }

  const weekBudgetLeft = E - spentWeek;
  const remainingRaw = weekBudgetLeft < poolRem ? weekBudgetLeft : poolRem;
  const remaining = remainingRaw > 0n ? remainingRaw : 0n;
  const capped = poolRem < weekBudgetLeft;

  const U = input.A - poolRem;

  return {
    spentP,
    excessP,
    poolRem,
    week: {
      start: weekStart,
      end: weekEnd,
      E,
      spent: spentWeek,
      remaining,
      capped,
    },
    U: U > 0n ? U : 0n,
    commitmentTotal,
  };
}
