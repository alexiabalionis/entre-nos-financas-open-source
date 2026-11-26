// Quais gastos do ritmo do dia a dia são, com boa chance, o pagamento de uma
// conta planejada em aberto (para não contar o mesmo dinheiro duas vezes).
// Só classifica para o ritmo: nada é conciliado nem gravado.

/** Valor dentro de ±20% do previsto (mesma tolerância das sugestões de conciliação). */
export function withinTolerance(amount: bigint, planned: bigint): boolean {
  const diff = amount - planned;
  return (diff < 0n ? -diff : diff) * 5n <= planned;
}

export type OpenBill = {
  id: string;
  month: string; // YYYY-MM
  category: string;
  remaining: bigint; // planejado - pago
  due: string | null; // YYYY-MM-DD
};

export type SpendCandidate = {
  key: string;
  date: string; // YYYY-MM-DD
  category: string | null;
  cents: bigint;
};

const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / 86_400_000;
const abs = (n: bigint) => (n < 0n ? -n : n);

/**
 * Cada conta em aberto absorve no máximo UM gasto: mesma categoria, mesmo
 * mês, valor até ±20% do restante. Vence o valor mais próximo; empate, a data
 * mais próxima do vencimento. Devolve as chaves dos gastos absorvidos.
 */
export function matchProbablePayments(
  bills: readonly OpenBill[],
  spends: readonly SpendCandidate[],
): Set<string> {
  const taken = new Set<string>();
  const ordered = [...bills].sort((a, b) =>
    (a.due ?? a.month).localeCompare(b.due ?? b.month) || a.id.localeCompare(b.id),
  );
  for (const bill of ordered) {
    if (bill.remaining <= 0n) continue;
    const reference = dayNumber(bill.due ?? bill.month + "-01");
    const best = spends
      .filter(
        (s) =>
          !taken.has(s.key) &&
          s.category === bill.category &&
          s.date.slice(0, 7) === bill.month &&
          withinTolerance(s.cents, bill.remaining),
      )
      .map((s) => ({
        s,
        value: abs(s.cents - bill.remaining),
        days: Math.abs(dayNumber(s.date) - reference),
      }))
      .sort(
        (a, b) =>
          (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) ||
          a.days - b.days ||
          a.s.key.localeCompare(b.s.key),
      )[0];
    if (best) taken.add(best.s.key);
  }
  return taken;
}
