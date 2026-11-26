import { dateOnly } from "./finance.ts";
import { shiftMonth } from "./card-cycle.ts";
import {
  billForDueMonth,
  billOf,
  type CycleVersion,
} from "./card-competence.ts";
import {
  project,
  type Day,
  type Flow,
  type ProjectionInput,
  type ProjectionResult,
} from "./projection.ts";

// Compra hipotética do simulador "Posso comprar?". `cash` sai de uma vez no
// dia; `card` vira parcelas, cada uma no vencimento da fatura que a contém.
export type Hypothetical = {
  cents: bigint;
  day: Day;
  method: "cash" | "card";
  installments: number;
  cycles?: CycleVersion[];
};

export type SimulateResult = {
  before: ProjectionResult;
  after: ProjectionResult;
  deltaCCons: bigint;
  byMonth: { month: string; cents: bigint }[];
};

// Fluxo de saída já consumido (sem defasagem nominal/consolidado): a compra
// hipotética pesa no caixa no próprio dia de caixa.
function outFlow(key: string, day: Day, cents: bigint): Flow {
  return {
    key,
    direction: "out",
    nom: { date: day, cents },
    cons: { date: day, cents },
  };
}

// Parcelas de uma compra de cartão: floor(cents/n) cada, o resto na última.
function installmentSplit(cents: bigint, count: number): bigint[] {
  const base = cents / BigInt(count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = cents - base * BigInt(count - 1);
  return parts;
}

/**
 * Parcelas de uma compra de cartão e o vencimento da fatura de cada uma. A 1ª
 * fatura vem de billOf(day, versão vigente em day); a k-ésima desloca
 * shiftMonth(1ª.month, k-1) e é resolvida por billForDueMonth. Lança erro de
 * domínio sem ciclo vigente (mesmas mensagens do simulador).
 */
export function cardPurchaseSchedule(h: {
  cents: bigint;
  day: Day;
  installments: number;
  cycles: readonly CycleVersion[];
}): { k: number; dueMonth: string; due: Day; cents: bigint }[] {
  if (h.cycles.length === 0)
    throw new Error("Compra de cartão exige um ciclo configurado.");
  const version = h.cycles.find(
    (v) =>
      v.valid_from <= h.day && (v.valid_until === null || h.day <= v.valid_until),
  );
  if (!version) throw new Error("Sem ciclo vigente na data da compra.");
  const first = billOf(h.day, version, 0);
  if (!first) throw new Error("O ciclo não define fatura para esta data.");
  const parts = installmentSplit(h.cents, h.installments);
  return parts.map((cents, k) => {
    const dueMonth = shiftMonth(first.month, k);
    const bill = k === 0 ? first : billForDueMonth(h.cycles, dueMonth);
    if (!bill)
      throw new Error("O ciclo mudou antes do fechamento de uma parcela.");
    return { k: k + 1, dueMonth, due: dateOnly(bill.dueDate), cents };
  });
}

/**
 * Simulador "Posso comprar?": projeta antes e depois de uma compra hipotética,
 * sem tocar nos dados reais. Pura. Retorna a variação do fôlego consolidado
 * (deltaCCons = after.cCons - before.cCons) e o peso de caixa por mês.
 *
 * - cash: uma única saída no dia da compra.
 * - card: parcelas iguais (resto na última), cada uma no vencimento da fatura
 *   que a contém. A 1ª fatura vem de billOf(day, versão vigente em day); a
 *   k-ésima desloca shiftMonth(1ª.month, k-1) e é resolvida por billForDueMonth.
 *   Sem ciclo disponível para uma compra de cartão, lança erro de domínio.
 *
 * Parcelas cujo vencimento cai depois do horizonte não entram no `after`, mas
 * aparecem em `byMonth` (o compromisso existe mesmo fora da projeção).
 */
export function simulate(
  base: ProjectionInput,
  h: Hypothetical,
): SimulateResult {
  if (h.cents <= 0n) throw new Error("Valor da compra deve ser positivo.");
  if (!Number.isInteger(h.installments) || h.installments < 1)
    throw new Error("Número de parcelas inválido.");
  const day = dateOnly(h.day);

  const added: { key: string; day: Day; cents: bigint }[] = [];

  if (h.method === "cash") {
    added.push({ key: "sim:0", day, cents: h.cents });
  } else {
    for (const p of cardPurchaseSchedule({
      cents: h.cents,
      day,
      installments: h.installments,
      cycles: h.cycles ?? [],
    }))
      added.push({ key: `sim:${p.k - 1}`, day: p.due, cents: p.cents });
  }

  const byMonthMap = new Map<string, bigint>();
  for (const a of added)
    byMonthMap.set(
      a.day.slice(0, 7),
      (byMonthMap.get(a.day.slice(0, 7)) ?? 0n) + a.cents,
    );
  const byMonth = [...byMonthMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, cents]) => ({ month, cents }));

  const before = project(base);
  const after = project({
    ...base,
    flows: [...base.flows, ...added.map((a) => outFlow(a.key, a.day, a.cents))],
  });

  return {
    before,
    after,
    deltaCCons: after.cCons - before.cCons,
    byMonth,
  };
}
