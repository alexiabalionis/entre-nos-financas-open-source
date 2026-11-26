import { dateOnly } from "./finance.ts";
import type { Day, DayPoint } from "./projection.ts";
import type { ConfidenceState } from "./projection-confidence.ts";

// Projeção POR MÊS (puro, sem I/O): modo do mês pedido em relação a "hoje",
// limites do mês e recortes da série diária do motor restritos a um mês.

export type MonthMode = "current" | "future" | "closed" | "unavailable";
export type MonthBounds = { start: Day; end: Day };

// Palavra de status que o SERVIDOR devolve (a tela não deriva).
export const STATUS_WORD: Record<ConfidenceState | Exclude<MonthMode, "current">, string> = {
  CONFIRMADO: "Confiável",
  COM_RESSALVA: "Com ressalva",
  DEPENDE_DE_DADOS: "Faltam dados",
  SEM_FOLGA: "Sem folga",
  INDETERMINADO: "Indeterminado",
  future: "Estimativa",
  closed: "Realizado",
  unavailable: "Sem projeção",
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function checkMonth(month: string): string {
  if (!MONTH_RE.test(month)) throw new Error("Mês inválido.");
  return month;
}

function monthAfter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Modo do mês pedido (YYYY-MM) em relação a today (YYYY-MM-DD, BRT):
// igual=current; seguinte=future; depois do seguinte=unavailable; anterior=closed.
export function monthMode(today: Day, month: string): MonthMode {
  const current = dateOnly(today).slice(0, 7);
  checkMonth(month);
  if (month === current) return "current";
  if (month < current) return "closed";
  return month === monthAfter(current) ? "future" : "unavailable";
}

// Primeiro e último dia do mês (fev bissexto e virada dez->jan inclusos).
export function monthBounds(month: string): MonthBounds {
  checkMonth(month);
  const start = dateOnly(month + "-01");
  const last = new Date(monthAfter(month) + "-01T12:00:00Z");
  last.setUTCDate(0);
  return { start, end: last.toISOString().slice(0, 10) };
}

// Pontos da série cujo dia está dentro do mês.
export function sliceToMonth(
  series: readonly DayPoint[],
  bounds: MonthBounds,
): DayPoint[] {
  return series.filter((p) => p.day >= bounds.start && p.day <= bounds.end);
}

// Saldo conservador no início de `day`: o do último ponto com dia <= day. A
// série comprimida omite dias sem mudança, então o valor é carregado adiante.
// null quando nenhum ponto é anterior ou igual a `day`.
export function startCentsAt(
  series: readonly DayPoint[],
  day: Day,
): bigint | null {
  let found: bigint | null = null;
  let foundDay = "";
  for (const p of series)
    if (p.day <= day && p.day >= foundDay) {
      found = p.cons;
      foundDay = p.day;
    }
  return found;
}

// Mesma definição de `low` do motor (project()), restrita ao mês: menor nom e
// menor cons (primeiro dia do mínimo). null se o mês não tem pontos.
export function lowWithin(
  series: readonly DayPoint[],
  bounds: MonthBounds,
): {
  nom: { day: Day; cents: bigint };
  cons: { day: Day; cents: bigint };
} | null {
  const inMonth = sliceToMonth(series, bounds);
  if (inMonth.length === 0) return null;
  let lowNom = inMonth[0];
  let lowCons = inMonth[0];
  for (const p of inMonth) {
    if (p.nom < lowNom.nom) lowNom = p;
    if (p.cons < lowCons.cons) lowCons = p;
  }
  return {
    nom: { day: lowNom.day, cents: lowNom.nom },
    cons: { day: lowCons.day, cents: lowCons.cons },
  };
}

// Mesma definição de `deficit` do motor: cCons = low.cons - cushion; se < 0,
// {cents: -cCons, day: dia do low.cons}; senão null. Restrito ao mês.
export function deficitWithin(
  series: readonly DayPoint[],
  bounds: MonthBounds,
  cushion: bigint,
): { cents: bigint; day: Day } | null {
  const low = lowWithin(series, bounds);
  if (!low) return null;
  const cCons = low.cons.cents - cushion;
  return cCons < 0n ? { cents: -cCons, day: low.cons.day } : null;
}
