import { shiftMonth } from "./card-cycle.ts";
import { median } from "./median.ts";

// F0c do Copiloto (parte 2): agrega o histórico de gastos por (cartão/dinheiro,
// lojista) para SUGERIR contas que se repetem. Não projeta nada sozinho: conta
// fixa é só o que a pessoa liga a uma série. Função PURA: sem I/O, sem banco,
// não muta a entrada e é determinística.

export type Spend = {
  // id do cartão ou 'cash' para gastos fora de cartão.
  scope: string;
  merchant: string;
  // YYYY-MM do gasto.
  month: string;
  day: number;
  // valor POSITIVO em centavos.
  cents: bigint;
};

// Os 3 meses completos anteriores a currentMonth. Candidato precisa aparecer em
// >= 2 deles. A janela é fixa (3 meses) para não deixar um gasto antigo e
// isolado virar previsão.
function previousMonths(currentMonth: string): string[] {
  return [3, 2, 1].map((back) => shiftMonth(currentMonth, -back));
}

// nom = valor esperado. Com >= 3 meses, a mediana do total mensal (resistente a
// um mês atípico). Com exatamente 2 meses, a mediana degeneraria no menor
// valor; usamos a MÉDIA INTEIRA TRUNCADA dos 2 para não subestimar demais.
// cons = maior total mensal (pior caso para o caixa).
function nominalAndConservative(monthlyTotals: bigint[]): {
  nom: bigint;
  cons: bigint;
} {
  const sorted = [...monthlyTotals].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const cons = sorted[sorted.length - 1]!;
  // Com 2 meses a média dos dois do meio é a própria média inteira dos 2.
  return { nom: median(sorted), cons };
}

// day = dia mais frequente entre as ocorrências; empate resolve para o MENOR
// dia (determinístico e conservador: cobra mais cedo no caixa).
function dominantDay(days: number[]): number {
  const freq = new Map<number, number>();
  for (const d of days) freq.set(d, (freq.get(d) ?? 0) + 1);
  let best = days[0]!;
  let bestCount = 0;
  for (const [day, count] of freq)
    if (count > bestCount || (count === bestCount && day < best)) {
      best = day;
      bestCount = count;
    }
  return best;
}

type Agg = {
  scope: string;
  merchant: string;
  byMonth: Map<string, { total: bigint; days: number[] }>;
};

// Agrupa por (scope, merchant), guardando por mês (da janela) o total e os
// dias.
function aggregate(history: Spend[], currentMonth: string): Agg[] {
  const windowSet = new Set(previousMonths(currentMonth));
  const aggs = new Map<string, Agg>();
  for (const s of history) {
    // A janela de detecção é só os 3 meses anteriores.
    if (!windowSet.has(s.month)) continue;
    const ak = `${s.scope}\u0000${s.merchant}`;
    let agg = aggs.get(ak);
    if (!agg) {
      agg = { scope: s.scope, merchant: s.merchant, byMonth: new Map() };
      aggs.set(ak, agg);
    }
    const m = agg.byMonth.get(s.month);
    if (m) {
      m.total += s.cents;
      m.days.push(s.day);
    } else agg.byMonth.set(s.month, { total: s.cents, days: [s.day] });
  }
  return [...aggs.values()];
}

// Valor parecido: dentro de ±20% da referência (centavos, BigInt, sem float).
export function isSimilarAmount(amount: bigint, ref: bigint): boolean {
  const diff = amount > ref ? amount - ref : ref - amount;
  return diff * 100n <= ref * 20n;
}

export type MonthlyCandidate = {
  scope: string;
  merchant: string;
  nom: bigint;
  day: number;
  months: number;
};

// Contas que se repetem pelo comportamento: um gasto por mês, em >= 2 dos 3
// meses da janela, com valor parecido (±20% da mediana). Só sugere: quem
// decide se é conta fixa é a pessoa (cria a série; recusas ficam em
// recurrence_decisions).
export function monthlyCandidates(
  history: Spend[],
  currentMonth: string,
): MonthlyCandidate[] {
  const out: MonthlyCandidate[] = [];
  for (const agg of aggregate(history, currentMonth)) {
    const months = [...agg.byMonth.values()];
    if (months.length < 2 || months.some((m) => m.days.length !== 1)) continue;
    const { nom } = nominalAndConservative(months.map((m) => m.total));
    if (!months.every((m) => isSimilarAmount(m.total, nom))) continue;
    out.push({
      scope: agg.scope,
      merchant: agg.merchant,
      nom,
      day: dominantDay(months.flatMap((m) => m.days)),
      months: months.length,
    });
  }
  return out.sort((a, b) => (a.nom < b.nom ? 1 : a.nom > b.nom ? -1 : 0));
}
