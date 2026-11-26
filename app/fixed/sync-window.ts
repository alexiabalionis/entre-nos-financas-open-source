import { moveMonth } from "../lib/dates.ts";

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Janela do sync: do mês anterior ao mais cedo até o fim do mais tarde (hoje + 2 meses ou o mês visto). */
export function syncWindow(
  current: string,
  month: string,
): { from: string; through: string } {
  const earliest = current < month ? current : month;
  const horizon = moveMonth(current, 2);
  const latest = horizon > month ? horizon : month;
  return {
    from: moveMonth(earliest, -1) + "-01",
    through: lastDay(latest),
  };
}
