import { dateOnly } from "./finance.ts";

export type Day = string;
export type Flow = {
  key: string;
  direction: "in" | "out";
  nom: { date: Day; cents: bigint };
  cons: { date: Day; cents: bigint };
  // Saída já iniciada (ex: PIX agendado) mas ainda NÃO refletida em sConf. Por
  // isso ela reduz D; uma saída initiated já vencida (cons.date < today) cai em
  // today e ainda reduz D — o dinheiro vai sair sem o saldo ter baixado ainda.
  initiated?: boolean;
};
export type ProjectionInput = {
  today: Day;
  horizonEnd: Day;
  cushion: bigint;
  sConf: bigint;
  flows: readonly Flow[];
};
export type DayPoint = { day: Day; nom: bigint; cons: bigint };
export type ProjectionResult = {
  series: DayPoint[];
  sConf: bigint;
  D: bigint;
  cNom: bigint;
  cCons: bigint;
  low: { nom: { day: Day; cents: bigint }; cons: { day: Day; cents: bigint } };
  deficit: { cents: bigint; day: Day } | null;
  negative: { cents: bigint; day: Day } | null;
};

function nextDay(day: Day): Day {
  const parsed = new Date(day + "T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function listDays(today: Day, horizonEnd: Day): Day[] {
  const days: Day[] = [];
  for (let day = today; day <= horizonEnd; day = nextDay(day)) days.push(day);
  return days;
}

// Vencido (data < today) entra em today; data > horizonEnd fica fora.
function landingDay(date: Day, today: Day, horizonEnd: Day): Day | null {
  if (date > horizonEnd) return null;
  return date < today ? today : date;
}

export function project(input: ProjectionInput): ProjectionResult {
  const today = dateOnly(input.today);
  const horizonEnd = dateOnly(input.horizonEnd);
  if (horizonEnd < today)
    throw new Error("Horizonte da projeção termina antes de hoje.");
  const { cushion, sConf } = input;

  const seen = new Set<string>();
  const nomMoves = new Map<Day, bigint>();
  const consMoves = new Map<Day, bigint>();
  let initiatedOut = 0n;

  for (const flow of input.flows) {
    if (seen.has(flow.key)) throw new Error("Fluxo com key duplicada.");
    seen.add(flow.key);
    if (flow.nom.cents < 0n || flow.cons.cents < 0n)
      throw new Error("Fluxo com valor negativo.");
    const sign = flow.direction === "out" ? -1n : 1n;

    const nomDate = landingDay(dateOnly(flow.nom.date), today, horizonEnd);
    if (nomDate)
      nomMoves.set(
        nomDate,
        (nomMoves.get(nomDate) ?? 0n) + sign * flow.nom.cents,
      );
    const consDate = landingDay(dateOnly(flow.cons.date), today, horizonEnd);
    if (consDate)
      consMoves.set(
        consDate,
        (consMoves.get(consDate) ?? 0n) + sign * flow.cons.cents,
      );

    if (flow.direction === "out" && flow.initiated && flow.cons.date <= today)
      initiatedOut += flow.cons.cents;
  }

  const series: DayPoint[] = [];
  let nom = sConf;
  let cons = sConf;
  for (const day of listDays(today, horizonEnd)) {
    nom += nomMoves.get(day) ?? 0n;
    cons += consMoves.get(day) ?? 0n;
    series.push({ day, nom, cons });
  }

  let lowNom = series[0];
  let lowCons = series[0];
  for (const point of series) {
    if (point.nom < lowNom.nom) lowNom = point;
    if (point.cons < lowCons.cons) lowCons = point;
  }

  const cNom = lowNom.nom - cushion;
  const cCons = lowCons.cons - cushion;

  return {
    series,
    sConf,
    D: sConf - initiatedOut,
    cNom,
    cCons,
    low: {
      nom: { day: lowNom.day, cents: lowNom.nom },
      cons: { day: lowCons.day, cents: lowCons.cons },
    },
    deficit: cCons < 0n ? { cents: -cCons, day: lowCons.day } : null,
    negative:
      lowCons.cons < 0n ? { cents: -lowCons.cons, day: lowCons.day } : null,
  };
}

export function capacityFrom(
  r: ProjectionResult,
  cushion: bigint,
  from: Day,
): bigint {
  const start = dateOnly(from);
  let min: bigint | null = null;
  for (const point of r.series)
    if (point.day >= start && (min === null || point.cons < min))
      min = point.cons;
  if (min === null) throw new Error("Nenhum dia a partir de from.");
  return min - cushion;
}
