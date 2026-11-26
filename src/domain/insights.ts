// Panorama (insights) puro: médias de entrada e saída, sobra, comparação por
// categoria, fixo x dia a dia, gasto por dia e lugares. Sem banco, sem React.
// Valores em centavos (bigint); meses 'YYYY-MM'; dias 'YYYY-MM-DD'.
import { addDays } from "./day.ts";
import { shiftMonth } from "./card-cycle.ts";

export type MonthFlow = { month: string; in: bigint; out: bigint };
export type Spend = {
  date: string;
  cents: bigint;
  merchant: string;
  // Nome sem dado de pessoa (promptLabel), quando a fonte tem.
  label?: string;
  categoryName: string | null;
  // Evento que originou o gasto (null para lançamento do banco ainda pendente).
  eventId?: string | null;
};

const sum = (l: readonly bigint[]) => l.reduce((a, b) => a + b, 0n);
const monthOf = (day: string) => day.slice(0, 7);

// Médias só dos meses fechados (o mês atual ainda está pela metade).
/**
 * Médias de entrada, saída e sobra dos meses dados (regra única, a do
 * Panorama): cada média trunca em centavos e a sobra é avg(in) − avg(out).
 * Só compare resultados com a mesma população (mesma leitura, período e
 * competência); o histórico confirmado da Judite (T1) é outra população.
 */
export function averageFlows(months: readonly MonthFlow[]) {
  const n = BigInt(months.length);
  if (n === 0n) return null;
  const avgIn = sum(months.map((m) => m.in)) / n;
  const avgOut = sum(months.map((m) => m.out)) / n;
  return { avgIn, avgOut, kept: avgIn - avgOut };
}

export function monthSummary(months: readonly MonthFlow[], currentMonth: string) {
  const closed = months.filter((m) => m.month < currentMonth && (m.in > 0n || m.out > 0n));
  if (!closed.length) return null;
  const { avgIn, avgOut, kept: keptAvg } = averageFlows(closed)!;
  const kept = closed.map((m) => m.in - m.out);
  const best = closed.reduce((a, m) => (m.in - m.out > a.in - a.out ? m : a));
  return {
    months: closed.length,
    avgIn,
    avgOut,
    keptAvg,
    // Percentual inteiro do que entra e fica; null sem entrada.
    keptPct: avgIn > 0n ? Number((keptAvg * 100n) / avgIn) : null,
    best: { month: best.month, kept: best.in - best.out },
    negative: closed.filter((m, i) => kept[i] < 0n).map((m) => m.month),
  };
}

export type CategoryRow = { name: string; cents: bigint; prev: bigint | null };

export const NO_CATEGORY = "Sem categoria";

// Soma `cents` por chave; chave null pula a linha.
export function sumBy<T>(
  rows: readonly T[],
  key: (r: T) => string | null,
  cents: (r: T) => bigint,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const r of rows) {
    const k = key(r);
    if (k !== null) out.set(k, (out.get(k) ?? 0n) + cents(r));
  }
  return out;
}

const byCategory = (rows: readonly Spend[]) =>
  sumBy(rows, (r) => r.categoryName ?? NO_CATEGORY, (r) => r.cents);

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Este mês até hoje (com os mesmos dias do mês passado), o mês passado
// inteiro e os 3 meses fechados. Ordenado do maior para o menor.
// Dia de referência do Panorama para o mês pedido na URL. Mês passado: o
// último dia dele (o Panorama mostra como tudo estava quando o mês fechou).
// Mês atual, futuro ou nenhum: hoje (o futuro ainda não tem lançamentos).
export function insightsAnchor(today: string, month?: string) {
  const thisMonth = today.slice(0, 7);
  if (!month || month >= thisMonth)
    return { today, current: true, future: !!month && month > thisMonth };
  return { today: `${month}-${String(daysIn(month)).padStart(2, "0")}`, current: false, future: false };
}

export function categoryPeriods(spend: readonly Spend[], today: string) {
  const month = monthOf(today);
  const last = shiftMonth(month, -1);
  const day = Math.min(Number(today.slice(8, 10)), daysIn(last));
  const lastSameDays = `${last}-${String(day).padStart(2, "0")}`;
  const quarterFrom = shiftMonth(month, -3);
  const sorted = (m: Map<string, bigint>, prev?: Map<string, bigint>): CategoryRow[] =>
    [...m]
      .filter(([, cents]) => cents !== 0n)
      .map(([name, cents]) => ({ name, cents, prev: prev ? (prev.get(name) ?? 0n) : null }))
      .sort((a, b) => (a.cents < b.cents ? 1 : a.cents > b.cents ? -1 : 0));
  return {
    month: sorted(
      byCategory(spend.filter((r) => monthOf(r.date) === month && r.date <= today)),
      byCategory(spend.filter((r) => monthOf(r.date) === last && r.date <= lastSameDays)),
    ),
    lastMonth: sorted(byCategory(spend.filter((r) => monthOf(r.date) === last))),
    quarter: sorted(
      byCategory(spend.filter((r) => monthOf(r.date) >= quarterFrom && monthOf(r.date) < month)),
    ),
  };
}

// Gasto de cada categoria em cada um dos `months`. Fecha com a saída mensal:
// a soma das categorias de um mês é a mesma de MonthFlow.out, estorno incluso.
export function categoryByMonth(
  spend: readonly Spend[],
  months: readonly string[],
): { month: string; name: string; cents: bigint }[] {
  return months.flatMap((month) =>
    [...byCategory(spend.filter((r) => monthOf(r.date) === month))]
      .filter(([, cents]) => cents !== 0n)
      .map(([name, cents]) => ({ month, name, cents })),
  );
}

// Fixo x dia a dia do mês: fixo = gasto cujo evento é conta fixa (conciliado
// a uma série de despesa; ver server/fixed-events.ts).
export function fixedSplit(
  spend: readonly Spend[],
  p: { month: string; fixedEvents: ReadonlySet<string> },
) {
  let fixed = 0n;
  let everyday = 0n;
  for (const r of spend) {
    if (monthOf(r.date) !== p.month) continue;
    if (r.eventId != null && p.fixedEvents.has(r.eventId)) fixed += r.cents;
    else everyday += r.cents;
  }
  return { fixed, everyday };
}

// Gasto de cada dia do mês até hoje; dias depois de hoje ficam null.
export function dailySpend(spend: readonly Spend[], today: string): (bigint | null)[] {
  const month = monthOf(today);
  const last = Number(today.slice(8, 10));
  const days: (bigint | null)[] = Array.from({ length: daysIn(month) }, (_, i) =>
    i < last ? 0n : null,
  );
  for (const r of spend) {
    if (monthOf(r.date) !== month || r.date > today) continue;
    const i = Number(r.date.slice(8, 10)) - 1;
    days[i] = (days[i] ?? 0n) + r.cents;
  }
  return days;
}

export type Place = {
  merchant: string;
  // Nome sem dado de pessoa (o label do primeiro gasto), quando a fonte tem.
  safeLabel?: string;
  category: string | null;
  visits: number;
  total: bigint;
  average: bigint;
  last: string;
};

// Lugares a partir de `from` (inclusive): visitas, total, média e a última
// vez. Categoria = a mais frequente do lugar.
export function places(spend: readonly Spend[], from: string): Place[] {
  const acc = new Map<string, { total: bigint; visits: number; last: string; label?: string; cats: Map<string, number> }>();
  for (const r of spend) {
    if (r.date < from || !r.merchant || r.cents <= 0n) continue;
    const a = acc.get(r.merchant) ?? { total: 0n, visits: 0, last: r.date, label: r.label, cats: new Map() };
    a.total += r.cents;
    a.visits += 1;
    if (r.date > a.last) a.last = r.date;
    if (r.categoryName) a.cats.set(r.categoryName, (a.cats.get(r.categoryName) ?? 0) + 1);
    acc.set(r.merchant, a);
  }
  return [...acc]
    .map(([merchant, a]) => ({
      merchant,
      ...(a.label !== undefined ? { safeLabel: a.label } : {}),
      category: [...a.cats].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      visits: a.visits,
      total: a.total,
      average: a.total / BigInt(a.visits),
      last: a.last,
    }))
    .sort((a, b) => (a.total < b.total ? 1 : a.total > b.total ? -1 : 0));
}

// Saldo no fim de cada dia, de `from` a `to`, somando as contas cujo saldo
// inicial já vale naquele dia. moves = lançamentos por conta e dia.
export function balanceSeries(p: {
  from: string;
  to: string;
  accounts: readonly { id: string; openingCents: bigint; openingDate: string }[];
  moves: readonly { account: string; date: string; cents: bigint }[];
}): { day: string; cents: bigint }[] {
  const byDay = new Map<string, Map<string, bigint>>();
  for (const m of p.moves) {
    const d = byDay.get(m.date) ?? new Map<string, bigint>();
    d.set(m.account, (d.get(m.account) ?? 0n) + m.cents);
    byDay.set(m.date, d);
  }
  const running = new Map<string, bigint>();
  // Lançamentos antes de `from` já entram no saldo de partida.
  for (const m of p.moves)
    if (m.date < p.from) running.set(m.account, (running.get(m.account) ?? 0n) + m.cents);
  const out: { day: string; cents: bigint }[] = [];
  for (let day = p.from; day <= p.to; day = addDays(day, 1)) {
    for (const [account, cents] of byDay.get(day) ?? [])
      running.set(account, (running.get(account) ?? 0n) + cents);
    const open = p.accounts.filter((a) => a.openingDate <= day);
    if (!open.length) continue;
    out.push({
      day,
      cents: sum(open.map((a) => a.openingCents + (running.get(a.id) ?? 0n))),
    });
  }
  return out;
}
