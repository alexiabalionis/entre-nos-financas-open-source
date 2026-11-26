// Leitura de abertura (SPEC-JUDITE-PROFUNDIDADE, Fase 2b): quais categorias
// vale abrir e o que tem dentro delas. Puro: recebe as compras já lidas, com o
// rótulo pronto (apelido ou Pix opaco), e só escolhe, soma e ordena.

export const UNCATEGORIZED = "Sem categoria";
const MAX_CATEGORIES = 5;
const TOP_BY_TOTAL = 3;
const MAX_PURCHASES = 3;
const MAX_PLACES = 3;
const MIN_REPEATS = 3;

export type OpeningBuy = {
  date: string; // 'YYYY-MM-DD'
  category: string;
  cents: bigint; // positivo = gasto
  rotulo: string;
  /** Lugar ou destinatário para agrupar; null quando não há como agrupar. */
  place: string | null;
  /** Conta fixa e parcela ficam fora das compras e dos lugares (não são decisão do dia a dia). */
  fixedLike: boolean;
};

export type OpeningCategory = {
  categoria: string;
  total_periodo: bigint;
  media_3_fechados: bigint;
  media_6_fechados: bigint;
  maiores_compras: { dia: string; rotulo: string; cents: bigint }[];
  lugares_que_se_repetem: { rotulo: string; vezes: number; total: bigint }[];
};

const monthOf = (date: string) => date.slice(0, 7);
const byName = (a: string, b: string) => a.localeCompare(b);
const desc = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);

function perMonth(total: bigint, months: number): bigint {
  if (months <= 0) return 0n;
  const n = BigInt(months);
  return (total + n / 2n) / n;
}

function sumBy(buys: readonly OpeningBuy[], months: ReadonlySet<string>) {
  const out = new Map<string, bigint>();
  for (const b of buys) if (months.has(monthOf(b.date))) out.set(b.category, (out.get(b.category) ?? 0n) + b.cents);
  return out;
}

/** Até 3 por maior total nos fechados, mais até 2 de maior alta (média dos 3 contra a dos 6), no máximo 5. */
export function pickCategories(buys: readonly OpeningBuy[], closed: readonly string[]): string[] {
  const last3 = closed.slice(-3);
  const totals3 = sumBy(buys, new Set(last3));
  const totals6 = sumBy(buys, new Set(closed));
  const names = [...totals6.keys()].filter((c) => c !== UNCATEGORIZED);
  const top = names
    .filter((c) => (totals3.get(c) ?? 0n) > 0n)
    .sort((a, b) => desc(totals3.get(a) ?? 0n, totals3.get(b) ?? 0n) || byName(a, b))
    .slice(0, TOP_BY_TOTAL);
  const rise = (c: string) => perMonth(totals3.get(c) ?? 0n, last3.length) - perMonth(totals6.get(c) ?? 0n, closed.length);
  const risers = names
    .filter((c) => !top.includes(c) && rise(c) > 0n)
    .sort((a, b) => desc(rise(a), rise(b)) || byName(a, b))
    .slice(0, MAX_CATEGORIES - top.length);
  return [...top, ...risers].slice(0, MAX_CATEGORIES);
}

export function openingReading(p: { buys: readonly OpeningBuy[]; closed: readonly string[]; current: string }): OpeningCategory[] {
  const last3 = new Set(p.closed.slice(-3));
  const period = new Set([...last3, p.current]);
  return pickCategories(p.buys, p.closed).map((categoria) => {
    const own = p.buys.filter((b) => b.category === categoria);
    const total = (months: ReadonlySet<string>) => own.filter((b) => months.has(monthOf(b.date))).reduce((s, b) => s + b.cents, 0n);
    const daily = own.filter((b) => period.has(monthOf(b.date)) && !b.fixedLike && b.cents > 0n);
    const groups = new Map<string, { rotulo: string; vezes: number; total: bigint }>();
    for (const b of daily) {
      if (b.place === null) continue;
      const key = b.place.toLowerCase();
      const g = groups.get(key) ?? { rotulo: b.rotulo, vezes: 0, total: 0n };
      g.vezes++;
      g.total += b.cents;
      groups.set(key, g);
    }
    return {
      categoria,
      total_periodo: total(period),
      media_3_fechados: perMonth(total(last3), last3.size),
      media_6_fechados: perMonth(total(new Set(p.closed)), p.closed.length),
      maiores_compras: [...daily]
        .sort((a, b) => desc(a.cents, b.cents) || (a.date < b.date ? 1 : a.date > b.date ? -1 : byName(a.rotulo, b.rotulo)))
        .slice(0, MAX_PURCHASES)
        .map((b) => ({ dia: b.date, rotulo: b.rotulo, cents: b.cents })),
      lugares_que_se_repetem: [...groups.values()]
        .filter((g) => g.vezes >= MIN_REPEATS)
        .sort((a, b) => desc(a.total, b.total) || b.vezes - a.vezes || byName(a.rotulo, b.rotulo))
        .slice(0, MAX_PLACES),
    };
  });
}
