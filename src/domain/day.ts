// Aritmética de datas 'YYYY-MM-DD' sem fuso: âncora ao meio-dia UTC, como o
// motor de projeção, para não pular dia em horário de verão.
export function addDays(day: string, days: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Segunda-feira da semana (ISO) que contém `day`.
export function mondayOf(day: string): string {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

// Dias de `from` até `to` (negativo quando `to` vem antes).
export function diffDays(from: string, to: string): number {
  const a = Date.parse(from + "T12:00:00Z");
  const b = Date.parse(to + "T12:00:00Z");
  return Math.round((b - a) / 86_400_000);
}
