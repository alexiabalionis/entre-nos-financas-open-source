import { addDays } from "./day.ts";

// "Como chegamos nesse valor" e as semanas até o salário (puro). Reparte o
// saldo do dia mais apertado (low.cons) nos mesmos fluxos que o motor usou,
// sem recalcular nada: saldo de hoje + entradas - contas - reserva até aquele
// dia. O que sobrar (ex.: ajuste do saldo desatualizado) vira uma linha
// própria, então a soma sempre fecha com o livre.

type FlowLike = {
  key: string;
  direction: "in" | "out";
  cons: { date: string; cents: bigint };
};

export type Breakdown = {
  start: bigint;
  income: bigint;
  bills: bigint;
  reserve: bigint;
  adjust: bigint;
  margin: bigint;
  reserveOnAccount: bigint;
  livre: bigint;
  lowDay: string;
};

export type Week = { from: string; to: string; bills: bigint };

type Part = "income" | "bills" | "reserve";

function partOf(flow: FlowLike): Part {
  if (flow.direction === "in") return "income";
  if (flow.key.startsWith("reserve:") || flow.key.startsWith("resdecl:"))
    return "reserve";
  return "bills";
}

// Mesma regra do motor: vencido cai em hoje.
const landing = (flow: FlowLike, today: string) =>
  flow.cons.date < today ? today : flow.cons.date;

export function breakdown(p: {
  today: string;
  sConf: bigint;
  flows: readonly FlowLike[];
  low: { day: string; cents: bigint };
  margin: bigint;
  reserveOnAccount: bigint;
}): Breakdown {
  const sums: Record<Part, bigint> = { income: 0n, bills: 0n, reserve: 0n };
  for (const flow of p.flows) {
    if (landing(flow, p.today) > p.low.day) continue;
    sums[partOf(flow)] += flow.cons.cents;
  }
  const counted = p.sConf + sums.income - sums.bills - sums.reserve;
  return {
    start: p.sConf,
    ...sums,
    adjust: p.low.cents - counted,
    margin: p.margin,
    reserveOnAccount: p.reserveOnAccount,
    livre: p.low.cents - p.margin - p.reserveOnAccount,
    lowDay: p.low.day,
  };
}

// Semanas de 7 dias a partir de hoje até `until` (a última pode ser menor),
// com as contas que vencem em cada uma. A semana com conta pesa mais.
export function weeks(p: {
  today: string;
  until: string;
  flows: readonly FlowLike[];
}): Week[] {
  const out: Week[] = [];
  for (let from = p.today; from <= p.until; from = addDays(from, 7)) {
    const end = addDays(from, 6);
    out.push({ from, to: end < p.until ? end : p.until, bills: 0n });
  }
  for (const flow of p.flows) {
    if (partOf(flow) !== "bills") continue;
    const day = landing(flow, p.today);
    const week = out.find((w) => w.from <= day && day <= w.to);
    if (week) week.bills += flow.cons.cents;
  }
  return out;
}
