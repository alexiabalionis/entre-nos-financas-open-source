// "Como sobrar mais?": caminhos para levar a sobra média a um alvo, cortando
// o dia a dia que está acima do normal da própria casa. Determinístico: a
// Judite só explica o resultado, nunca calcula (SPEC-JUDITE-COMO-SOBRAR-MAIS).
//
// Regra provisória (a pessoa disse "acima da própria média, mas não tenho
// certeza"; revisar com ela): a folga de cada categoria é a média dos últimos
// 3 meses fechados menos a média de todos os meses fechados. Só dia a dia
// (sem contas fixas nem parcelas). Categorias protegidas ficam fora.

import { averageFlows, type MonthFlow } from "./insights.ts";

export type { MonthFlow };
/** Gasto de dia a dia de uma categoria num mês fechado. */
export type CategoryMonth = { month: string; name: string; cents: bigint };
export type SobraTarget = { pct: number } | { cents: bigint };

export type PathStep = {
  name: string;
  /** Média dos meses fechados (o normal da casa). */
  usual: bigint;
  /** Média dos últimos 3 meses fechados. */
  recent: bigint;
  /** Quanto cortar por mês: voltar de `recent` para `usual`. */
  cut: bigint;
  /** Sobra média e % depois deste passo (acumulado). */
  kept: bigint;
  pct: number | null;
};

export type SobraPaths = {
  months: number;
  avgIn: bigint;
  avgOut: bigint;
  kept: bigint;
  pct: number | null;
  target: { kept: bigint; pct: number | null };
  /** Quanto falta da sobra atual até o alvo (0 se já chegou). */
  gap: bigint;
  steps: PathStep[];
  /** O que os passos não cobrem: a Judite pergunta onde dá, não inventa. */
  missing: bigint;
  /** Categorias protegidas acima do normal, à parte (com a mesma conta). */
  protectedAbove: { name: string; usual: bigint; recent: bigint }[];
};

const RECENT = 3;

const pctOf = (kept: bigint, avgIn: bigint) => (avgIn > 0n ? Number((kept * 1000n) / avgIn) / 10 : null);

/**
 * `months` e `categories` só com meses fechados. `today` decide o que é fechado:
 * mês anterior ao de hoje e com algum movimento (mesma regra do Panorama).
 */
type EverydayInput = {
  months: readonly MonthFlow[];
  categories: readonly CategoryMonth[];
  protectedNames: ReadonlySet<string>;
  currentMonth: string;
};

export type AboveUsual = {
  months: number;
  avgIn: bigint;
  avgOut: bigint;
  kept: bigint;
  pct: number | null;
  /** Todas as não protegidas acima do normal, do maior excesso para o menor. */
  above: { name: string; usual: bigint; recent: bigint; excess: bigint }[];
  protectedAbove: { name: string; usual: bigint; recent: bigint }[];
};

/** "Onde dá para cortar?": tudo que está acima do normal, sem alvo. */
export function aboveUsual(p: EverydayInput): AboveUsual | null {
  const base = averages(p);
  if (!base) return null;
  const { closed, avgIn, avgOut, kept, above } = base;
  return {
    months: closed.length,
    avgIn,
    avgOut,
    kept,
    pct: pctOf(kept, avgIn),
    above: above
      .filter((r) => !p.protectedNames.has(r.name))
      .map((r) => ({ ...r, excess: r.recent - r.usual })),
    protectedAbove: above
      .filter((r) => p.protectedNames.has(r.name))
      .map(({ name, usual, recent }) => ({ name, usual, recent })),
  };
}

function averages(p: EverydayInput) {
  const closed = p.months
    .filter((m) => m.month < p.currentMonth && (m.in > 0n || m.out > 0n))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (closed.length === 0) return null;
  const n = BigInt(closed.length);
  const { avgIn, avgOut, kept } = averageFlows(closed)!;
  const recentMonths = new Set(closed.slice(-RECENT).map((m) => m.month));
  const nRecent = BigInt(recentMonths.size);
  const closedSet = new Set(closed.map((m) => m.month));
  const byName = new Map<string, { total: bigint; recent: bigint }>();
  for (const c of p.categories) {
    if (!closedSet.has(c.month)) continue;
    const e = byName.get(c.name) ?? { total: 0n, recent: 0n };
    e.total += c.cents;
    if (recentMonths.has(c.month)) e.recent += c.cents;
    byName.set(c.name, e);
  }
  const rows = [...byName.entries()].map(([name, e]) => ({
    name,
    usual: e.total / n,
    recent: e.recent / nRecent,
  }));
  const above = rows
    .filter((r) => r.recent > r.usual)
    .sort((a, b) => {
      const d = b.recent - b.usual - (a.recent - a.usual);
      return d > 0n ? 1 : d < 0n ? -1 : a.name.localeCompare(b.name);
    });
  return { closed, avgIn, avgOut, kept, above };
}

export function sobraPaths(p: EverydayInput & { target: SobraTarget }): SobraPaths | null {
  const base = averages(p);
  if (!base) return null;
  const { closed, avgIn, avgOut, kept, above } = base;
  const targetKept =
    "cents" in p.target ? p.target.cents : (avgIn * BigInt(Math.round(p.target.pct * 10))) / 1000n;
  const gap = targetKept > kept ? targetKept - kept : 0n;

  const steps: PathStep[] = [];
  let acc = kept;
  if (gap > 0n)
    for (const r of above.filter((r) => !p.protectedNames.has(r.name))) {
      if (acc >= targetKept) break;
      const cut = r.recent - r.usual;
      acc += cut;
      steps.push({ name: r.name, usual: r.usual, recent: r.recent, cut, kept: acc, pct: pctOf(acc, avgIn) });
    }

  return {
    months: closed.length,
    avgIn,
    avgOut,
    kept,
    pct: pctOf(kept, avgIn),
    target: { kept: targetKept, pct: pctOf(targetKept, avgIn) },
    gap,
    steps,
    missing: targetKept > acc ? targetKept - acc : 0n,
    protectedAbove: above
      .filter((r) => p.protectedNames.has(r.name))
      .map(({ name, usual, recent }) => ({ name, usual, recent })),
  };
}
