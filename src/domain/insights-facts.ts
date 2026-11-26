import type { Insights, CategorySpend } from "../server/insights.ts";

export type CategorySpendItem = {
  date: string;
  label: string;
  cents: string;
  confirmed: boolean;
};
export type CategorySpendContext = {
  month: string;
  categories: {
    name: string;
    cents: string;
    item_count: number;
    items?: CategorySpendItem[];
  }[];
  total_cents: string;
};
const ITEMS_PER_CATEGORY = 80;
// Só as categorias citadas na pergunta levam a lista de compras: o resto vai
// só com total e contagem, para o contexto não crescer com o mês inteiro.
export function categorySpendContext(
  s: CategorySpend,
  withItems: (name: string) => boolean,
): CategorySpendContext {
  return {
    month: s.month,
    categories: s.categories.map((c) => ({
      name: c.name,
      cents: c.cents.toString(),
      item_count: c.items.length,
      ...(withItems(c.name)
        ? {
            items: c.items.slice(0, ITEMS_PER_CATEGORY).map((i) => ({
              date: i.date,
              label: i.label,
              cents: i.cents.toString(),
              confirmed: i.confirmed,
            })),
          }
        : {}),
    })),
    total_cents: s.total_cents.toString(),
  };
}

// Seleção compacta do panorama para a Judite: só top-N e totais, bigint em
// string. Nunca months/categoryMonths/days/balance brutos nem `merchant`.
export type InsightsContext = {
  summary: {
    closed_months: number;
    avg_income_cents: string;
    avg_spend_cents: string;
    avg_kept_cents: string;
    kept_pct: number | null;
    best_month: { month: string; kept_cents: string };
    negative_months: string[];
  } | null;
  categories_month: {
    name: string;
    cents: string;
    prev_cents: string | null;
  }[];
  categories_last_month: { name: string; cents: string }[];
  places_year: {
    label: string;
    category: string | null;
    visits: number;
    total_cents: string;
    average_cents: string;
    last: string;
  }[];
};

export function insightsContext(
  insights: Insights,
  opts: { top?: number } = {},
): InsightsContext {
  const top = opts.top ?? 5;
  const s = insights.summary;
  return {
    summary: s
      ? {
          closed_months: s.months,
          avg_income_cents: s.avgIn.toString(),
          avg_spend_cents: s.avgOut.toString(),
          avg_kept_cents: s.keptAvg.toString(),
          kept_pct: s.keptPct,
          best_month: {
            month: s.best.month,
            kept_cents: s.best.kept.toString(),
          },
          negative_months: s.negative,
        }
      : null,
    categories_month: insights.categories.month.slice(0, top).map((r) => ({
      name: r.name,
      cents: r.cents.toString(),
      prev_cents: r.prev === null ? null : r.prev.toString(),
    })),
    categories_last_month: insights.categories.lastMonth
      .slice(0, top)
      .map((r) => ({ name: r.name, cents: r.cents.toString() })),
    // Só o nome sem dado de pessoa vai à IA; lugares com o mesmo nome (ex.:
    // vários "Pix enviado") viram uma linha só.
    places_year: mergeByLabel(insights.places.year)
      .slice(0, top)
      .map((p) => ({
        label: p.label,
        category: p.category,
        visits: p.visits,
        total_cents: p.total.toString(),
        average_cents: (p.total / BigInt(p.visits)).toString(),
        last: p.last,
      })),
  };
}

function mergeByLabel(list: Insights["places"]["year"]) {
  const by = new Map<string, { label: string; category: string | null; visits: number; total: bigint; last: string }>();
  for (const p of list) {
    const key = p.safeLabel ?? p.label;
    const e = by.get(key);
    if (!e) {
      by.set(key, { label: key, category: p.category, visits: p.visits, total: p.total, last: p.last });
      continue;
    }
    e.visits += p.visits;
    e.total += p.total;
    if (p.last > e.last) e.last = p.last;
  }
  return [...by.values()].sort((a, b) => (a.total < b.total ? 1 : a.total > b.total ? -1 : 0));
}
