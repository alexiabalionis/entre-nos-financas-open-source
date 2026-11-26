// Análises de tempo (1, 6 e 8): onde no calendário o gasto avulso se concentra.
import { diffDays } from "./day.ts";
import {
  LIMITS,
  byHalf,
  groupsOf,
  makeHighlight,
  sumCents,
  toReais,
  umaAMenos,
  type Ctx,
  type Found,
  type Item,
  type Recorte,
} from "./spend-patterns-core.ts";
import { check, type RejectReason } from "./spend-patterns-trace.ts";

export const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const BANDS = [
  { key: "madrugada", from: 0, to: 6 },
  { key: "manhã", from: 6, to: 11 },
  { key: "almoço", from: 11, to: 14 },
  { key: "tarde", from: 14, to: 18 },
  { key: "noite", from: 18, to: 22 },
  { key: "tarde da noite", from: 22, to: 24 },
] as const;

export const weekdayOf = (day: string): string => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]!;
const bandOf = (hour: number) => BANDS.find((b) => hour >= b.from && hour < b.to)!;

type Axis = {
  id: string;
  hour: boolean;
  minCount: number;
  keys: string[];
  cut: (day: string, hour: number | null) => string | null;
  // Fração do dia que pertence ao corte (o esperado é proporcional a isso).
  weight: (key: string, day: string) => number;
};

const dayAxis = (id: string, keys: string[], cut: (day: string) => string): Axis => ({
  id,
  hour: false,
  minCount: LIMITS.minCorteCompras,
  keys,
  cut: (d) => cut(d),
  weight: (k, d) => (cut(d) === k ? 1 : 0),
});

const AXES: Axis[] = [
  dayAxis("dia_da_semana", [...WEEKDAYS], weekdayOf),
  dayAxis("dia_util_ou_fim_de_semana", ["dia útil", "fim de semana"], (d) =>
    ["sábado", "domingo"].includes(weekdayOf(d)) ? "fim de semana" : "dia útil",
  ),
  dayAxis("parte_do_mes", ["início", "meio", "fim"], (d) => {
    const n = Number(d.slice(8));
    return n <= 10 ? "início" : n <= 20 ? "meio" : "fim";
  }),
  dayAxis("semana_do_mes", ["1ª", "2ª", "3ª", "4ª", "5ª"], (d) => `${Math.min(5, Math.ceil(Number(d.slice(8)) / 7))}ª`),
  {
    id: "hora_do_dia",
    hour: true,
    minCount: LIMITS.minCorteCompras,
    keys: BANDS.map((b) => b.key),
    cut: (_d, h) => (h === null ? null : bandOf(h).key),
    weight: (k) => {
      const b = BANDS.find((x) => x.key === k)!;
      return (b.to - b.from) / 24;
    },
  },
  {
    id: "dia_da_semana_e_hora",
    hour: true,
    minCount: LIMITS.minCelulaDiaHora,
    keys: WEEKDAYS.flatMap((w) => BANDS.map((b) => `${w} ${b.key}`)),
    cut: (d, h) => (h === null ? null : `${weekdayOf(d)} ${bandOf(h).key}`),
    weight: (k, d) => {
      const band = BANDS.find((b) => b.key === k.slice(k.indexOf(" ") + 1))!;
      return k.startsWith(`${weekdayOf(d)} `) ? (band.to - band.from) / 24 : 0;
    },
  },
];

type Cell = { count: number; cents: number; index: number; items: Item[] };

function cells(axis: Axis, items: readonly Item[], days: readonly string[]): Map<string, Cell> {
  const total = sumCents(items);
  const out = new Map<string, Cell>();
  if (!total || !days.length) return out;
  for (const key of axis.keys) {
    const mine = items.filter((i) => axis.cut(i.day, i.hour) === key);
    const exposure = days.reduce((s, d) => s + axis.weight(key, d), 0) / days.length;
    const cents = sumCents(mine);
    out.set(key, { count: mine.length, cents, index: exposure > 0 ? cents / total / exposure : 0, items: mine });
  }
  return out;
}

export function analyzeConcentration(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const groups = groupsOf(ctx.avulso, ["casa", "categoria", "etiqueta", "conta", "lugar", "pagamento"]);
  for (const g of groups) {
    for (const axis of AXES) {
      if (axis.hour && !ctx.hourEnabled) continue;
      const base = axis.hour ? g.items.filter((i) => i.hour !== null) : g.items;
      const recorte = { tipo: g.tipo, chave: g.chave };
      if (base.length < LIMITS.minRecorteCompras) {
        ctx.trace?.add({ analise: "concentracao_tempo", recorte, variante: axis.id, motivo: "insufficient_base", base,
          checks: [check("compras_no_recorte", base.length, LIMITS.minRecorteCompras, false)] });
        continue;
      }
      res.evaluated++;
      const whole = cells(axis, base, ctx.allDays);
      const h0 = cells(axis, byHalf(base, 0), ctx.days[0]);
      const h1 = cells(axis, byHalf(base, 1), ctx.days[1]);
      let best: { key: string; cell: Cell; excess: number; halves: [number, number] } | null = null;
      for (const [key, cell] of whole) {
        const a = h0.get(key)?.index ?? 0;
        const b = h1.get(key)?.index ?? 0;
        if (cell.count < axis.minCount || cell.index < LIMITS.indiceMin) continue;
        if (a < LIMITS.indiceMetade || b < LIMITS.indiceMetade) continue;
        const excess = (cell.cents - cell.cents / cell.index) / ctx.nMonths;
        if (!best || excess > best.excess) best = { key, cell, excess, halves: [a, b] };
      }
      if (ctx.trace) traceConcentration(ctx, recorte, axis, base, { whole, h0, h1 }, best);
      if (!best) continue;
      res.found.push(
        makeHighlight("concentracao_tempo", { ...g, items: base }, `${axis.id}: ${best.key}`, best.cell.items, {
          indice: best.cell.index,
          metades: best.halves,
          alavancas: [{ tipo: "corte_no_pico", cents: toReais(best.excess) }, ...umaAMenos(base, ctx)],
        }),
      );
    }
  }
  return res;
}

type CellMaps = { whole: Map<string, Cell>; h0: Map<string, Cell>; h1: Map<string, Cell> };

// Mesmas verificações do laço acima, na mesma ordem, só para dizer por que cada fatia caiu.
function cellReason(axis: Axis, cell: Cell, a: number, b: number): RejectReason | null {
  if (cell.count < axis.minCount) return "insufficient_subset";
  if (cell.index < LIMITS.indiceMin) return "below_threshold";
  if (a < LIMITS.indiceMetade || b < LIMITS.indiceMetade) return "not_persistent";
  return null;
}

function traceConcentration(
  ctx: Ctx,
  recorte: { tipo: Recorte; chave: string },
  axis: Axis,
  base: readonly Item[],
  maps: CellMaps,
  best: { key: string; cell: Cell } | null,
) {
  const fatias = [...maps.whole].map(([key, cell]) => {
    const a = maps.h0.get(key)?.index ?? 0;
    const b = maps.h1.get(key)?.index ?? 0;
    return { fatia: key, compras: cell.count, cents: Math.round(cell.cents), indice: cell.index, metade_anterior: a, metade_recente: b, motivo: cellReason(axis, cell, a, b) };
  });
  const top = [...fatias].sort((x, y) => y.indice - x.indice)[0];
  const chosen = best ? fatias.find((f) => f.fatia === best.key)! : top;
  ctx.trace!.add({
    analise: "concentracao_tempo",
    recorte,
    variante: axis.id,
    motivo: best ? null : (top?.motivo ?? "below_threshold"),
    corte: best ? `${axis.id}: ${best.key}` : null,
    base,
    cut: best ? best.cell.items : null,
    checks: chosen
      ? [
          check("compras_na_fatia", chosen.compras, axis.minCount, chosen.compras >= axis.minCount),
          check("indice", chosen.indice, LIMITS.indiceMin, chosen.indice >= LIMITS.indiceMin),
          check("indice_metade_anterior", chosen.metade_anterior, LIMITS.indiceMetade, chosen.metade_anterior >= LIMITS.indiceMetade),
          check("indice_metade_recente", chosen.metade_recente, LIMITS.indiceMetade, chosen.metade_recente >= LIMITS.indiceMetade),
        ]
      : [],
    evidencia: { fatia_avaliada: chosen?.fatia ?? null, distribuicao: fatias },
  });
}

export function analyzeSalaryRhythm(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const s = ctx.salaryDates;
  const casa = { tipo: "casa" as const, chave: "casa" };
  if (s.length < 2) {
    ctx.trace?.add({ analise: "ritmo_salario", recorte: casa, motivo: "no_salary_dates", base: ctx.avulso,
      checks: [check("datas_de_salario", s.length, 2, false)], evidencia: { datas_de_salario: s } });
    return res;
  }
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const inCycle = (d: string) => d >= first && d < last;
  const after = (d: string) => {
    const prev = [...s].reverse().find((x) => x <= d)!;
    return diffDays(prev, d) < LIMITS.diasAposSalario;
  };
  const cycleItems = ctx.avulso.filter((i) => inCycle(i.day));
  if (cycleItems.length < LIMITS.minRecorteCompras) {
    ctx.trace?.add({ analise: "ritmo_salario", recorte: casa, motivo: "insufficient_base", base: cycleItems,
      checks: [check("compras_no_ciclo", cycleItems.length, LIMITS.minRecorteCompras, false)], evidencia: { datas_de_salario: s } });
    return res;
  }
  res.evaluated++;
  const index = (items: readonly Item[], days: readonly string[]) => {
    const cd = days.filter(inCycle);
    const total = sumCents(items);
    if (!cd.length || !total) return { share: 0, index: 0, cents: 0, cut: [] as Item[], expected: 0 };
    const cut = items.filter((i) => after(i.day));
    const expected = cd.filter(after).length / cd.length;
    return { share: sumCents(cut) / total, index: sumCents(cut) / total / expected, cents: sumCents(cut), cut, expected };
  };
  const whole = index(cycleItems, ctx.allDays);
  const a = index(byHalf(cycleItems, 0), ctx.days[0]);
  const b = index(byHalf(cycleItems, 1), ctx.days[1]);
  const reason: RejectReason | null =
    whole.cut.length < LIMITS.minCorteCompras ? "insufficient_subset"
    : whole.index < LIMITS.indiceMin ? "below_threshold"
    : a.index < LIMITS.indiceMetade || b.index < LIMITS.indiceMetade ? "not_persistent"
    : null;
  ctx.trace?.add({
    analise: "ritmo_salario",
    recorte: casa,
    motivo: reason,
    corte: reason ? null : "7 dias depois do salário",
    base: cycleItems,
    cut: whole.cut,
    checks: [
      check("compras_depois_do_salario", whole.cut.length, LIMITS.minCorteCompras, whole.cut.length >= LIMITS.minCorteCompras),
      check("indice", whole.index, LIMITS.indiceMin, whole.index >= LIMITS.indiceMin),
      check("indice_metade_anterior", a.index, LIMITS.indiceMetade, a.index >= LIMITS.indiceMetade),
      check("indice_metade_recente", b.index, LIMITS.indiceMetade, b.index >= LIMITS.indiceMetade),
    ],
    evidencia: {
      datas_de_salario: s,
      dias_contados_apos_salario: LIMITS.diasAposSalario,
      parte_do_gasto: whole.share,
      parte_esperada_dos_dias: whole.expected,
      parte_do_gasto_metades: [a.share, b.share],
    },
  });
  if (reason) return res;
  const group = { ...casa, items: cycleItems };
  const excess = (whole.cents - sumCents(cycleItems) * whole.expected) / ctx.nMonths;
  res.found.push(
    makeHighlight("ritmo_salario", group, "7 dias depois do salário", whole.cut, {
      indice: whole.index,
      metades: [a.index, b.index],
      alavancas: [],
      emJogo: excess,
    }),
  );
  return res;
}

export function analyzeOutlierDays(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const casa = { tipo: "casa" as const, chave: "casa" };
  if (ctx.avulso.length < LIMITS.minRecorteCompras) {
    ctx.trace?.add({ analise: "dias_fora_da_curva", recorte: casa, motivo: "insufficient_base", base: ctx.avulso,
      checks: [check("compras_avulsas", ctx.avulso.length, LIMITS.minRecorteCompras, false)] });
    return res;
  }
  res.evaluated++;
  const perDay = new Map<string, Item[]>();
  for (const i of ctx.avulso) perDay.set(i.day, [...(perDay.get(i.day) ?? []), i]);
  const mean = sumCents(ctx.avulso) / ctx.allDays.length;
  const peaks = [...perDay].filter(([, its]) => sumCents(its) > LIMITS.picoMultiplo * mean);
  const picos = ctx.trace
    ? peaks.map(([d, its]) => ({ dia: d, dia_da_semana: weekdayOf(d), compras: its.length, cents: sumCents(its), ids: its.map((i) => i.p.id ?? "") }))
    : [];
  if (peaks.length < LIMITS.picosMin) {
    ctx.trace?.add({ analise: "dias_fora_da_curva", recorte: casa, motivo: "insufficient_subset", base: ctx.avulso,
      cut: peaks.flatMap(([, its]) => its),
      checks: [check("dias_de_pico", peaks.length, LIMITS.picosMin, false)],
      evidencia: { media_diaria_cents: mean, multiplo_do_pico: LIMITS.picoMultiplo, picos } });
    return res;
  }
  const half = (d: string): 0 | 1 => (ctx.days[0].includes(d) ? 0 : 1);
  for (const w of new Set(peaks.map(([d]) => weekdayOf(d)))) {
    const mine = peaks.filter(([d]) => weekdayOf(d) === w);
    const share = mine.length / peaks.length;
    const shares = [0, 1].map((h) => {
      const hp = peaks.filter(([d]) => half(d) === h);
      const hm = hp.filter(([d]) => weekdayOf(d) === w);
      return hp.length >= LIMITS.recorrenciaMinPorMetade ? hm.length / hp.length : 0;
    }) as [number, number];
    const halfMin = LIMITS.picoDiaSemanaMin / LIMITS.indiceMetade;
    const cut = mine.flatMap(([, its]) => its);
    const corte = `${w}: ${mine.length} de ${peaks.length} picos`;
    const reason: RejectReason | null =
      share < LIMITS.picoDiaSemanaMin ? "below_threshold" : shares.some((x) => x < halfMin) ? "not_persistent" : null;
    ctx.trace?.add({
      analise: "dias_fora_da_curva",
      recorte: casa,
      variante: w,
      motivo: reason,
      corte: reason ? null : corte,
      base: ctx.avulso,
      cut,
      checks: [
        check("parte_dos_picos", share, LIMITS.picoDiaSemanaMin, share >= LIMITS.picoDiaSemanaMin),
        check("parte_metade_anterior", shares[0], halfMin, shares[0] >= halfMin),
        check("parte_metade_recente", shares[1], halfMin, shares[1] >= halfMin),
      ],
      evidencia: { media_diaria_cents: mean, multiplo_do_pico: LIMITS.picoMultiplo, picos },
    });
    if (reason) continue;
    const excess = (sumCents(cut) - mine.length * mean) / ctx.nMonths;
    res.found.push(
      makeHighlight("dias_fora_da_curva", { tipo: "casa", chave: "casa", items: ctx.avulso }, corte, cut, {
        indice: share,
        metades: shares,
        alavancas: [],
        emJogo: excess,
      }),
    );
  }
  return res;
}
