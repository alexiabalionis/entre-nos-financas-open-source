import { dateOnly } from "./finance.ts";
export function shiftMonth(month: string, delta: number) {
  dateOnly(month + "-01");
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function dayInMonth(month: string, day: number) {
  dateOnly(month + "-01");
  if (!Number.isInteger(day) || day < 1 || day > 31)
    throw new Error("Dia de cartão inválido.");
  const [y, m] = month.split("-").map(Number),
    last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + "-" + String(Math.min(last, day)).padStart(2, "0");
}
// Deriva o mês de vencimento (YYYY-MM) da fatura que CONTÉM uma compra, pela
// data da compra e o ciclo configurado. Regra única compartilhada entre a
// projeção de faturas (cards.ts) e o orçamento por competência (state.ts) — não
// duplicar. Testa do mês da compra até +2 para cobrir o offset do vencimento;
// retorna null se a data não cai em nenhuma janela projetável.
export function dueMonthFromCycle(
  transactionDate: string,
  cycle: { closing_day: number; due_day: number; due_month_offset: number },
): string | null {
  const buyMonth = transactionDate.slice(0, 7);
  for (let d = 0; d <= 2; d++) {
    const m = shiftMonth(buyMonth, d);
    const p = cardCyclePeriod(
      m,
      cycle.closing_day,
      cycle.due_day,
      cycle.due_month_offset,
    );
    if (transactionDate >= p.start_date && transactionDate <= p.close_date)
      return m;
  }
  return null;
}
export function cardCyclePeriod(
  month: string,
  closingDay: number,
  dueDay: number,
  offset: number,
) {
  if (![0, 1].includes(offset)) throw new Error("Ciclo de cartão inválido.");
  const closingMonth = shiftMonth(month, -offset),
    close_date = dayInMonth(closingMonth, closingDay),
    due_date = dayInMonth(month, dueDay);
  const start = new Date(
    dayInMonth(shiftMonth(closingMonth, -1), closingDay) + "T00:00:00Z",
  );
  start.setUTCDate(start.getUTCDate() + 1);
  return {
    start_date: start.toISOString().slice(0, 10),
    close_date,
    due_date,
    needs_review: due_date <= close_date,
  };
}
