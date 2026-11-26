// Avisos de dados sujos (SPEC-JUDITE-LACUNAS, Fase 2): o que pode distorcer a
// análise antes de sugerir corte. Puro, sem I/O; só separa e rotula as compras
// que a leitura de padroes já trouxe.
import { median } from "./median.ts";
import { placeOf, type Purchase } from "./spend-patterns-core.ts";

/** Mesmo texto que toPurchase põe quando a linha não tem categoria. */
export const NO_CATEGORY = "Sem categoria";
const MAX_GROUPS = 8;
const MAX_OUTLIERS = 5;
// Uma compra pesa mais que 40% da categoria no mês e o mês passa de 1,5x a mediana.
const SHARE_PCT = 40n;
const MONTH_FACTOR_X10 = 15n;

export type UncategorizedGroup = { recipient: string | null; place: string | null; count: number; cents: bigint };
export type Outlier = {
  category: string;
  month: string;
  cents: bigint;
  label: string;
  sharePct: number;
  categoryMonthCents: bigint;
  withoutItCents: bigint;
  normalCents: bigint;
};

const spend = (list: readonly Purchase[]) => list.filter((p) => p.cents > 0n);
const desc = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);

/** Compras sem categoria: Pix por destinatário opaco (dN), o resto por lugar. */
export function uncategorized(purchases: readonly Purchase[], recipients: ReadonlyMap<string, string>) {
  const rows = spend(purchases).filter((p) => p.category === NO_CATEGORY);
  const groups = new Map<string, UncategorizedGroup>();
  for (const p of rows) {
    const recipient = (p.id !== undefined ? recipients.get(p.id) : undefined) ?? null;
    const place = recipient ? null : placeOf(p.label);
    const key = recipient ?? place ?? "";
    const g = groups.get(key) ?? { recipient, place, count: 0, cents: 0n };
    g.count++;
    g.cents += p.cents;
    groups.set(key, g);
  }
  return {
    count: rows.length,
    cents: rows.reduce((s, p) => s + p.cents, 0n),
    groups: [...groups.values()].sort((a, b) => desc(a.cents, b.cents)).slice(0, MAX_GROUPS),
  };
}

/** Compra isolada que explica o mês da categoria; fixa e parcela são previsíveis e ficam fora. */
export function outliers(purchases: readonly Purchase[], recipients: ReadonlyMap<string, string>): Outlier[] {
  const usable = spend(purchases).filter((p) => p.type !== "fixa" && p.type !== "parcela" && p.category !== NO_CATEGORY);
  const byCategory = new Map<string, Map<string, Purchase[]>>();
  for (const p of usable) {
    const months = byCategory.get(p.category) ?? new Map<string, Purchase[]>();
    const month = p.date.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), p]);
    byCategory.set(p.category, months);
  }
  const out: Outlier[] = [];
  for (const [category, months] of byCategory) {
    const totals = new Map([...months].map(([m, list]) => [m, list.reduce((s, p) => s + p.cents, 0n)]));
    // Mediana só dos meses com gasto: categoria de um mês só não tem "normal" para comparar.
    const normal = median([...totals.values()]);
    for (const [month, list] of months) {
      const total = totals.get(month)!;
      if (total * 10n < normal * MONTH_FACTOR_X10) continue;
      const big = list.reduce((a, b) => (b.cents > a.cents ? b : a));
      if (big.cents * 100n <= total * SHARE_PCT) continue;
      const recipient = big.id !== undefined ? recipients.get(big.id) : undefined;
      out.push({
        category,
        month,
        cents: big.cents,
        label: recipient ? `${big.label} (${recipient})` : big.label,
        sharePct: Number((big.cents * 100n) / total),
        categoryMonthCents: total,
        withoutItCents: total - big.cents,
        normalCents: normal,
      });
    }
  }
  return out.sort((a, b) => desc(a.cents, b.cents)).slice(0, MAX_OUTLIERS);
}
