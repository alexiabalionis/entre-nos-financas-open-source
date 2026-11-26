// Ritmo de sempre do dia a dia (puro). Só referência: o Copiloto não desconta
// essa estimativa do saldo; mostra ao lado do quanto cabe por semana e usa
// para a margem padrão e para a sugestão de reserva.

import { median } from "./median.ts";

export type Rate = { nom: bigint; cons: bigint };

const MIN_WEEKS = 4;
export const WEEKS_WINDOW = 8;
const STEP = 1000n;

function dayDiff(from: string, to: string): number {
  const ms = Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z");
  return Math.round(ms / 86_400_000);
}

// Totais por semana (seg a dom) da janela que começa em `windowStart`, da mais
// antiga para a mais nova. Datas fora da janela são ignoradas.
export function weeklyTotals(p: {
  rows: readonly { date: string; cents: bigint }[];
  windowStart: string;
}): bigint[] {
  const totals: bigint[] = Array.from({ length: WEEKS_WINDOW }, () => 0n);
  for (const r of p.rows) {
    const i = Math.floor(dayDiff(p.windowStart, r.date) / 7);
    if (i >= 0 && i < WEEKS_WINDOW) totals[i] += r.cents;
  }
  return totals.map((t) => (t < 0n ? 0n : t));
}

// Ritmo semanal: conta só a partir da primeira semana com gasto; com menos de
// 4 semanas de histórico não há estimativa. nom = mediana (média inteira dos
// dois do meio quando par); cons = o maior entre a mediana e a média.
export function weeklyRate(weeks: readonly bigint[]): Rate | null {
  const first = weeks.findIndex((w) => w > 0n);
  if (first < 0) return null;
  const used = weeks.slice(first);
  if (used.length < MIN_WEEKS) return null;
  const nom = median(used);
  const mean = used.reduce((a, b) => a + b, 0n) / BigInt(used.length);
  return { nom, cons: nom > mean ? nom : mean };
}

// Margem padrão enquanto a pessoa não escolhe: meia semana típica,
// arredondada para baixo em R$ 10. Sem ritmo conhecido, zero.
export function defaultMargin(usualWeekly: bigint | null): bigint {
  if (usualWeekly === null || usualWeekly <= 0n) return 0n;
  return (usualWeekly / 2n / STEP) * STEP;
}
