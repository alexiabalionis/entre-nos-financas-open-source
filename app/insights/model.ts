// Modelo puro do Panorama: recortes por período, ordenação dos lugares e as
// leituras curtas de cada bloco. Sem React; recebe o fio de GET family/insights.
import type { InsightsWire } from "../../src/server/insights.ts";
import { NO_CATEGORY, sumBy } from "../../src/domain/insights.ts";
import { ddmm } from "../month/format.ts";

export type Money = (cents: bigint) => string;
type Place = InsightsWire["places"]["quarter"][number];
type CategoryRow = InsightsWire["categories"]["month"][number];

const SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const shortMonth = (month: string) => SHORT[Number(month.slice(5, 7)) - 1];

export type MonthRange = "tri" | "sem" | "ano";
export type BalanceRange = "d30" | "d90" | "ano";
export type CategoryPeriod = "month" | "lastMonth" | "quarter";
export type PlacePeriod = "quarter" | "year";
export type PlaceOrder = "visits" | "average" | "last" | "total";

export function monthsIn(w: InsightsWire, range: MonthRange) {
  const n = { tri: 3, sem: 6, ano: 12 }[range];
  return w.months.slice(-n);
}

export function inOutReading(w: InsightsWire, range: MonthRange): string {
  const neg = monthsIn(w, range)
    .filter((m) => m.month < w.today.slice(0, 7) && BigInt(m.out) > BigInt(m.in))
    .map((m) => shortMonth(m.month));
  return neg.length
    ? `Saiu mais do que entrou em ${neg.join(", ")}.`
    : "Entrou mais do que saiu em todos os meses fechados.";
}

export function balanceIn(w: InsightsWire, range: BalanceRange) {
  const days = { d30: 30, d90: 90, ano: 365 }[range];
  return w.balance.slice(-(days + 1));
}

export function balanceReading(
  points: { day: string; cents: string }[],
  money: Money,
): string {
  if (!points.length) return "";
  const low = points.reduce((a, p) => (BigInt(p.cents) < BigInt(a.cents) ? p : a));
  return `Menor saldo no período: ${money(BigInt(low.cents))}, em ${ddmm(low.day)}.`;
}

const LONG = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const longMonth = (month: string) => LONG.format(new Date(`${month}-01T00:00:00Z`));

/**
 * Textos que dependem do mês de referência. No mês atual: "este mês", "até
 * hoje". Num mês passado, o Panorama é como estava no fim dele, então os
 * rótulos dizem o nome do mês ("agosto", "julho").
 */
export function anchorCopy(w: Pick<InsightsWire, "today" | "current">) {
  const month = w.today.slice(0, 7);
  const prev = shiftMonthKey(month, -1);
  if (w.current)
    return {
      month: "Este mês",
      lastMonth: "Mês passado",
      monthSub: "este mês até hoje · barra clara = mesmos dias do mês passado",
      lastMonthSub: "mês passado inteiro",
      quarterSub: "últimos 3 meses fechados",
      prevLabel: "Mesmos dias do mês passado",
      prevReading: "mesmos dias do mês passado",
      meta: "este mês",
    };
  const name = longMonth(month);
  const prevName = longMonth(prev);
  return {
    month: cap(name),
    lastMonth: cap(prevName),
    monthSub: `${name} inteiro · barra clara = mesmos dias de ${prevName}`,
    lastMonthSub: `${prevName} inteiro`,
    quarterSub: `os 3 meses antes de ${name}`,
    prevLabel: `Mesmos dias de ${prevName}`,
    prevReading: `mesmos dias de ${prevName}`,
    meta: name,
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function shiftMonthKey(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function categoryReading(rows: CategoryRow[], money: Money, prevReading = "mesmos dias do mês passado"): string {
  const up = rows
    .filter((r) => r.prev !== null && BigInt(r.cents) - BigInt(r.prev) >= 5000n && BigInt(r.cents) * 4n > BigInt(r.prev) * 5n)
    .slice(0, 3)
    .map((r) => `${r.name.toLowerCase()} +${money(BigInt(r.cents) - BigInt(r.prev!))}`);
  return up.length ? `Acima dos ${prevReading}: ${up.join(", ")}.` : "";
}

export function fixedReading(w: InsightsWire): string {
  const fixed = BigInt(w.fixed.fixed), everyday = BigInt(w.fixed.everyday);
  const total = fixed + everyday;
  if (total === 0n) return "";
  if (fixed === 0n) return "Nenhuma categoria está marcada como fixa ainda.";
  return `${(everyday * 100n) / total}% do que saiu é dia a dia: é onde dá para mexer.`;
}

const WEEKDAY = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];

// Dia da semana que mais pesa no mês (média por ocorrência), se destoa.
export function daysReading(w: InsightsWire, money: Money): string {
  const month = w.today.slice(0, 7);
  const by = Array.from({ length: 7 }, () => ({ total: 0n, n: 0n }));
  w.days.forEach((v, i) => {
    if (v === null) return;
    const wd = new Date(`${month}-${String(i + 1).padStart(2, "0")}T12:00:00Z`).getUTCDay();
    by[wd].total += BigInt(v);
    by[wd].n += 1n;
  });
  const avg = by.map((b) => (b.n ? b.total / b.n : 0n));
  const all = by.reduce((a, b) => a + b.total, 0n);
  const count = by.reduce((a, b) => a + b.n, 0n);
  if (count < 7n) return "";
  const top = avg.indexOf(avg.reduce((a, b) => (b > a ? b : a)));
  const others = (all - by[top].total) / (count - by[top].n || 1n);
  const diff = avg[top] - others;
  return diff >= 5000n ? `Os ${WEEKDAY[top]} pesam mais: em média ${money(diff)} acima dos outros dias.` : "";
}

export function sortPlaces(list: Place[], order: PlaceOrder): Place[] {
  const key = (p: Place): bigint | number | string =>
    order === "visits" ? p.visits : order === "last" ? p.last : BigInt(order === "average" ? p.average : p.total);
  return [...list].sort((a, b) => {
    const x = key(a), y = key(b);
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

// Muitas compras pequenas: os lugares com mais visitas e média baixa.
export function placesReading(list: Place[], money: Money): string {
  const small = list.filter((p) => p.visits >= 8 && BigInt(p.average) < 10000n).sort((a, b) => b.visits - a.visits).slice(0, 2);
  if (!small.length) return "";
  const total = small.reduce((a, p) => a + BigInt(p.total), 0n);
  const visits = small.reduce((a, p) => a + p.visits, 0);
  const names = small.map((p) => p.label).join(" e ");
  return `${names} ${small.length > 1 ? "somam" : "soma"} ${money(total)}: muitas compras pequenas, ${visits} vezes no período.`;
}

// Saídas por categoria: barras empilhadas por mês. A matriz fecha com
// months[].out (estorno incluso); só o desenho ignora valor negativo.
export const OTHERS = "Outras";
// Mesmos limites de "Saídas por categoria" em app/budgets/outflow-model.ts
// (MAIN_MAX e MAIN_MIN_PERCENT, que lá não são exportados).
const MAIN_MAX = 5;
const MAIN_MIN_PERCENT = 5n;
const HEAVY_SHARE = 30n;

export type CategoryTrend = {
  months: string[];
  layers: string[];
  /** [mês][camada] em centavos; pode ser negativo. */
  cents: bigint[][];
  /** Média por camada só dos meses fechados do período. */
  average: bigint[];
};

const total = (l: Iterable<bigint>) => [...l].reduce((a, b) => a + b, 0n);
const byMonthName = (rows: InsightsWire["categoryMonths"]) =>
  sumBy(rows, (r) => r.name, (r) => BigInt(r.cents));

// Pelo menos R$ 50 e 25% além do habitual da categoria.
export const aboveAverage = (cents: bigint, avg: bigint) =>
  avg > 0n && cents - avg >= 5000n && cents * 4n > avg * 5n;

// À vista: as 5 maiores do período com pelo menos 5% das saídas, mais "Sem
// categoria" (sempre à vista); o resto vira "Outras".
export function categoryTrend(w: InsightsWire, range: MonthRange): CategoryTrend {
  const months = monthsIn(w, range).map((m) => m.month);
  const rows = w.categoryMonths.filter((r) => months.includes(r.month));
  const byName = byMonthName(rows);
  const all = total(byName.values());
  const main = [...byName]
    .filter(([name, c]) => name !== NO_CATEGORY && c > 0n && c * 100n >= all * MAIN_MIN_PERCENT)
    .sort(([, a], [, b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, MAIN_MAX)
    .map(([name]) => name);
  const named = (byName.get(NO_CATEGORY) ?? 0n) !== 0n ? [...main, NO_CATEGORY] : main;
  const perMonth = months.map((month) => {
    const cells = byMonthName(rows.filter((r) => r.month === month));
    const shown = named.map((n) => cells.get(n) ?? 0n);
    return { shown, others: total(cells.values()) - total(shown) };
  });
  const hasOthers = perMonth.some((m) => m.others !== 0n);
  const cents = perMonth.map((m) => (hasOthers ? [...m.shown, m.others] : m.shown));
  const layers = hasOthers ? [...named, OTHERS] : named;
  const closed = months.flatMap((m, i) => (m < w.today.slice(0, 7) ? [i] : []));
  const n = BigInt(closed.length);
  const average = layers.map((_, l) => (n === 0n ? 0n : total(closed.map((i) => cents[i][l])) / n));
  return { months, layers, cents, average };
}

/** Valores do gráfico em reais; o desenho não empilha valor negativo. */
export const trendChartValues = (t: CategoryTrend): number[][] =>
  t.cents.map((row) => row.map((c) => Math.max(0, Number(c)) / 100));

export function monthBreakdown(t: CategoryTrend, i: number, today: string) {
  const month = t.months[i];
  const sum = total(t.cents[i] ?? []);
  return t.layers
    .map((name, l) => {
      const cents = t.cents[i][l];
      return {
        name,
        cents,
        percent: sum > 0n ? Math.max(0, Number((cents * 100n) / sum)) : 0,
        above: month < today.slice(0, 7) && name !== OTHERS && aboveAverage(cents, t.average[l]),
      };
    })
    .filter((r) => r.cents !== 0n)
    .sort((a, b) => (a.cents < b.cents ? 1 : a.cents > b.cents ? -1 : 0));
}

// Só fala quando destoa: uma categoria que pesa muito no período e/ou o mês
// fechado que mais passou da média.
export function categoryTrendReading(t: CategoryTrend, money: Money, today: string): string {
  const parts: string[] = [];
  const totals = t.layers.map((_, l) => total(t.cents.map((row) => row[l])));
  const all = total(totals);
  const named = t.layers.flatMap((name, l) => (name === OTHERS ? [] : [{ name, l }]));
  const top = named.reduce<(typeof named)[number] | null>((a, b) => (!a || totals[b.l] > totals[a.l] ? b : a), null);
  if (top && all > 0n && (totals[top.l] * 100n) / all >= HEAVY_SHARE)
    parts.push(`${top.name} pesa ${(totals[top.l] * 100n) / all}% das saídas do período.`);
  let worst: { month: string; name: string; diff: bigint } | null = null;
  for (const [i, month] of t.months.entries()) {
    if (month >= today.slice(0, 7)) continue;
    for (const { name, l } of named) {
      const diff = t.cents[i][l] - t.average[l];
      if (aboveAverage(t.cents[i][l], t.average[l]) && (!worst || diff > worst.diff)) worst = { month, name, diff };
    }
  }
  if (worst) parts.push(`Em ${shortMonth(worst.month)}, ${worst.name} ficou ${money(worst.diff)} acima da média.`);
  return parts.join(" ");
}
