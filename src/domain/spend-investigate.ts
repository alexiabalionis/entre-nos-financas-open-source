// Investigação dirigida (puro): operações fechadas sobre as compras de um
// escopo que o servidor já filtrou. O modelo escolhe a operação e o filtro; o
// número sai daqui. Nada de consulta livre, nada de banco, nada de Date local.
// Reaproveita o contexto dos padrões (mesmas metades, mesma hora real).
import { addDays, diffDays } from "./day.ts";
import {
  LIMITS,
  buildContext,
  byHalf,
  listDays,
  placeOf,
  sumCents,
  type Ctx,
  type Item,
  type Payment,
  type PatternInput,
} from "./spend-patterns-core.ts";
import { weekdayOf, WEEKDAYS } from "./spend-patterns-time.ts";

export const OPERATIONS = [
  "serie_mensal",
  "comparar_periodos",
  "distribuicao",
  "ciclo_salario",
  "forma_pagamento",
  "fragmentacao",
  "recorrencias",
  "picos",
  "transacoes",
  "sequencia",
] as const;
export type Operation = (typeof OPERATIONS)[number];
export const AXES = ["dia_da_semana", "parte_do_mes", "hora_do_dia", "dias_apos_salario"] as const;
export type Axis = (typeof AXES)[number];

export const INVESTIGATE = {
  /** Abaixo disso o escopo é pouco para tirar conclusão (mesmos mínimos de padroes). */
  minCompras: LIMITS.minRecorteCompras,
  minMeses: 3,
  /** Mesma tolerância de valor da recorrência escondida. */
  tolerancia: LIMITS.recorrenciaTolerancia,
  recorrenciaMinOcorrencias: 3,
  recorrenciaMinMeses: 3,
  /** Dia do mês que se repete em pelo menos metade dos meses = compra de agenda. */
  agendaMinMeses: 0.5,
  picoMultiplo: LIMITS.picoMultiplo,
  maxLinhas: 50,
  maxGrupos: 10,
  /** Média recente: os últimos 3 meses fechados (decisão de 22/11/2026). */
  mesesRecentes: 3,
} as const;

/** Compra com o destinatário opaco (d0, d1...) que o servidor dá ao Pix e à transferência. */
export type InvestigateInput = PatternInput & { recipients?: ReadonlyMap<string, string> };

const ratio = (a: number, b: number) => (b ? a / b : null);
const round4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);
const cents = (n: number) => Math.round(n);
const monthsOf = (days: readonly string[]) => [...new Set(days.map((d) => d.slice(0, 7)))];

/** Quanto o escopo sustenta uma conclusão: contagens, nunca interpretação. */
export function coverage(ctx: Ctx, items: readonly Item[]) {
  const withSpend = new Set(items.map((i) => i.month));
  const pouca = items.length < INVESTIGATE.minCompras || withSpend.size < INVESTIGATE.minMeses;
  return {
    meses_no_periodo: ctx.nMonths,
    meses_com_gasto: withSpend.size,
    compras: items.length,
    evidencia: pouca ? ("pouca" as const) : ("suficiente" as const),
  };
}

function perMonth(ctx: Ctx, items: readonly Item[]) {
  const months = monthsOf(ctx.allDays);
  return months.map((m) => {
    const mine = items.filter((i) => i.month === m);
    return { mes: m, compras: mine.length, total_cents: cents(sumCents(mine)), ticket_medio_cents: mine.length ? cents(sumCents(mine) / mine.length) : null };
  });
}

/** Média por mês dos últimos 3 meses fechados (a base de "custo atual"). */
export function recentMonthly(ctx: Ctx, items: readonly Item[]): number {
  const months = monthsOf(ctx.allDays).slice(-INVESTIGATE.mesesRecentes);
  return months.length ? sumCents(items.filter((i) => months.includes(i.month))) / months.length : 0;
}

export function monthlySeries(ctx: Ctx, items: readonly Item[]) {
  const months = monthsOf(ctx.allDays);
  return {
    meses: perMonth(ctx, items),
    media_mensal_cents: cents(sumCents(items) / (months.length || 1)),
    media_ultimos_3_cents: cents(recentMonthly(ctx, items)),
  };
}

function periodStats(items: readonly Item[], months: readonly string[]) {
  const n = months.length || 1;
  return {
    meses: months,
    total_por_mes_cents: cents(sumCents(items) / n),
    compras_por_mes: Math.round((items.length / n) * 100) / 100,
    ticket_medio_cents: items.length ? cents(sumCents(items) / items.length) : null,
  };
}

/** Metade anterior x recente (as mesmas de padroes), ou dois conjuntos de meses. */
export function comparePeriods(ctx: Ctx, items: readonly Item[], a?: readonly string[], b?: readonly string[]) {
  const ma = a ?? monthsOf(ctx.days[0]);
  const mb = b ?? monthsOf(ctx.days[1]);
  const ia = items.filter((i) => ma.includes(i.month));
  const ib = items.filter((i) => mb.includes(i.month));
  const sa = periodStats(ia, ma);
  const sb = periodStats(ib, mb);
  const change = (x: number | null, y: number | null) => (x && y !== null ? round4(y / x - 1) : null);
  return {
    anterior: sa,
    recente: sb,
    variacao: {
      total: change(sa.total_por_mes_cents, sb.total_por_mes_cents),
      frequencia: change(sa.compras_por_mes, sb.compras_por_mes),
      ticket_medio: change(sa.ticket_medio_cents, sb.ticket_medio_cents),
    },
    diferenca_por_mes_cents: sb.total_por_mes_cents - sa.total_por_mes_cents,
  };
}

const BANDS = [
  ["madrugada", 0, 6], ["manhã", 6, 11], ["almoço", 11, 14], ["tarde", 14, 18], ["noite", 18, 22], ["tarde da noite", 22, 24],
] as const;
const partOf = (day: string) => {
  const n = Number(day.slice(8));
  return n <= 10 ? "início" : n <= 20 ? "meio" : "fim";
};

function lastSalaryBefore(salaries: readonly string[], day: string): string | null {
  let out: string | null = null;
  for (const s of salaries) if (s <= day) out = s;
  return out;
}

/**
 * Como o gasto do escopo se distribui num eixo, contra o esperado pelo número
 * de dias (índice 1 = proporcional). `agenda` mede compra em dia fixo do mês:
 * concentração que vem de agenda não é comportamento.
 */
export function distribution(ctx: Ctx, items: readonly Item[], axis: Axis) {
  const total = sumCents(items);
  type Slice = { fatia: string; compras: number; cents: number; parte: number | null; parte_esperada: number | null; indice: number | null };
  let keys: string[];
  let cut: (i: Item) => string | null;
  let exposure: (k: string) => number;
  let base = items;
  const days = ctx.allDays;
  if (axis === "dia_da_semana") {
    keys = [...WEEKDAYS];
    cut = (i) => weekdayOf(i.day);
    exposure = (k) => days.filter((d) => weekdayOf(d) === k).length / days.length;
  } else if (axis === "parte_do_mes") {
    keys = ["início", "meio", "fim"];
    cut = (i) => partOf(i.day);
    exposure = (k) => days.filter((d) => partOf(d) === k).length / days.length;
  } else if (axis === "hora_do_dia") {
    keys = BANDS.map((b) => b[0]);
    base = items.filter((i) => i.hour !== null);
    cut = (i) => BANDS.find((b) => i.hour! >= b[1] && i.hour! < b[2])![0];
    exposure = (k) => {
      const b = BANDS.find((x) => x[0] === k)!;
      return (b[2] - b[1]) / 24;
    };
  } else {
    const s = ctx.salaryDates;
    keys = ["até 7 dias depois do salário", "resto do ciclo"];
    const inCycle = (d: string) => s.length >= 2 && d >= s[0]! && d < s[s.length - 1]!;
    base = items.filter((i) => inCycle(i.day));
    const after = (d: string) => {
      const prev = lastSalaryBefore(s, d);
      return prev !== null && diffDays(prev, d) < LIMITS.diasAposSalario;
    };
    cut = (i) => (after(i.day) ? keys[0]! : keys[1]!);
    const cd = days.filter(inCycle);
    exposure = (k) => (cd.length ? cd.filter((d) => (after(d) ? keys[0] : keys[1]) === k).length / cd.length : 0);
  }
  const baseTotal = axis === "hora_do_dia" || axis === "dias_apos_salario" ? sumCents(base) : total;
  const fatias: Slice[] = keys.map((k) => {
    const mine = base.filter((i) => cut(i) === k);
    const parte = ratio(sumCents(mine), baseTotal);
    const exp = exposure(k);
    return { fatia: k, compras: mine.length, cents: cents(sumCents(mine)), parte: round4(parte), parte_esperada: round4(exp), indice: parte !== null && exp ? round4(parte / exp) : null };
  });
  // Agenda: compras que caem num dia do mês que aparece em pelo menos metade dos meses.
  const dayMonths = new Map<string, Set<string>>();
  for (const i of base) {
    const d = i.day.slice(8);
    (dayMonths.get(d) ?? dayMonths.set(d, new Set()).get(d)!).add(i.month);
  }
  const fixedDays = [...dayMonths].filter(([, ms]) => ms.size >= Math.max(2, ctx.nMonths * INVESTIGATE.agendaMinMeses)).map(([d]) => d);
  const onSchedule = base.filter((i) => fixedDays.includes(i.day.slice(8)));
  return {
    eixo: axis,
    compras_no_eixo: base.length,
    ...(axis === "hora_do_dia" ? { sem_hora_real: items.length - base.length } : {}),
    ...(axis === "dias_apos_salario" ? { datas_de_salario: ctx.salaryDates } : {}),
    fatias,
    agenda: {
      dias_do_mes_fixos: fixedDays.sort(),
      parte_em_dia_fixo: round4(ratio(sumCents(onSchedule), sumCents(base))),
    },
  };
}

/**
 * Cada ciclo de salário fechado: quanto do gasto avulso foi nos 7 primeiros
 * dias e quanto saiu no ciclo todo. O que diz se faltou dinheiro é a sobra de
 * cada mês fechado, que o servidor junta (`sobraPorMes`).
 */
export function salaryCycles(ctx: Ctx, items: readonly Item[], sobraPorMes: readonly { mes: string; sobra_cents: number }[]) {
  const s = ctx.salaryDates;
  const cycles: { de: string; ate: string; gasto_cents: number; avulso_7_dias_cents: number; parte_7_dias: number | null }[] = [];
  for (let k = 0; k + 1 < s.length; k++) {
    const [from, next] = [s[k]!, s[k + 1]!];
    if (from < ctx.from || next > addDays(ctx.to, 1)) continue;
    const mine = items.filter((i) => i.day >= from && i.day < next);
    const avulso = mine.filter((i) => i.p.type === "avulso");
    const early = avulso.filter((i) => diffDays(from, i.day) < LIMITS.diasAposSalario);
    cycles.push({
      de: from,
      ate: addDays(next, -1),
      gasto_cents: cents(sumCents(mine)),
      avulso_7_dias_cents: cents(sumCents(early)),
      parte_7_dias: round4(ratio(sumCents(early), sumCents(avulso))),
    });
  }
  const negative = sobraPorMes.filter((m) => m.sobra_cents < 0);
  return {
    datas_de_salario: s,
    ciclos: cycles,
    sobra_por_mes: sobraPorMes,
    meses_com_sobra_negativa: negative.length,
    menor_sobra_cents: sobraPorMes.length ? Math.min(...sobraPorMes.map((m) => m.sobra_cents)) : null,
  };
}

const PAYMENTS: readonly Payment[] = ["credito", "pix", "debito"];

/** Parte de cada forma de pagamento nas duas metades E o gasto total junto: a forma mudar não diz se o gasto mudou. */
export function paymentMix(ctx: Ctx, items: readonly Item[]) {
  const halves = [0, 1] as const;
  const months = [monthsOf(ctx.days[0]), monthsOf(ctx.days[1])];
  const partes = PAYMENTS.map((pay) => {
    const [a, b] = halves.map((h) => {
      const all = byHalf(items, h);
      return ratio(sumCents(all.filter((i) => i.p.payment === pay)), sumCents(all));
    });
    return { forma: pay, anterior: round4(a ?? null), recente: round4(b ?? null) };
  });
  const totals = halves.map((h) => sumCents(byHalf(items, h)) / (months[h]!.length || 1));
  return {
    partes,
    gasto_por_mes: { anterior_cents: cents(totals[0]!), recente_cents: cents(totals[1]!) },
    variacao_do_total: round4(totals[0] ? totals[1]! / totals[0] - 1 : null),
    por_mes: perMonth(ctx, items).map((m) => ({
      mes: m.mes,
      ...Object.fromEntries(PAYMENTS.map((pay) => [`${pay}_cents`, cents(sumCents(items.filter((i) => i.month === m.mes && i.p.payment === pay)))])),
    })),
  };
}

/** Por onde o mesmo tipo de gasto passa: formas de pagamento e contas/cartões, e em quantos meses mais de um. */
export function fragmentation(ctx: Ctx, items: readonly Item[]) {
  const total = sumCents(items);
  const group = (key: (i: Item) => string) => {
    const m = new Map<string, Item[]>();
    for (const i of items) (m.get(key(i)) ?? m.set(key(i), []).get(key(i))!).push(i);
    return [...m]
      .map(([k, its]) => ({ chave: k, compras: its.length, cents: cents(sumCents(its)), parte: round4(ratio(sumCents(its), total)) }))
      .sort((a, b) => b.cents - a.cents);
  };
  const months = monthsOf(ctx.allDays);
  const spread = months.map((m) => new Set(items.filter((i) => i.month === m).map((i) => i.p.card ?? i.p.account)).size);
  return {
    por_forma: group((i) => i.p.payment),
    por_conta: group((i) => i.p.card ?? i.p.account),
    contas_distintas: new Set(items.map((i) => i.p.card ?? i.p.account)).size,
    meses_com_mais_de_uma_conta: spread.filter((n) => n > 1).length,
    media_mensal_cents: cents(total / (months.length || 1)),
  };
}

const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/**
 * Pagamentos parecidos ao mesmo lugar ou destinatário: valor típico (mediana,
 * ±10%), vezes por mês, intervalos e se já é conta fixa. Pix entra pelo
 * destinatário opaco, nunca pelo nome.
 */
export function recurrences(ctx: Ctx, items: readonly Item[], recipients: ReadonlyMap<string, string>) {
  const keyOf = (i: Item) => {
    const r = i.p.id ? recipients.get(i.p.id) : undefined;
    if (r) return { tipo: "destinatario" as const, chave: r };
    const place = placeOf(i.p.label);
    return place ? { tipo: "lugar" as const, chave: place } : null;
  };
  const groups = new Map<string, { tipo: "lugar" | "destinatario"; chave: string; items: Item[] }>();
  for (const i of items) {
    const k = keyOf(i);
    if (!k) continue;
    const id = `${k.tipo}:${k.chave}`;
    (groups.get(id) ?? groups.set(id, { ...k, items: [] }).get(id)!).items.push(i);
  }
  const months = monthsOf(ctx.allDays);
  const out = [];
  for (const g of groups.values()) {
    if (g.items.length < INVESTIGATE.recorrenciaMinOcorrencias) continue;
    const mid = median(g.items.map((i) => i.cents));
    const similar = g.items.filter((i) => Math.abs(i.cents - mid) <= mid * INVESTIGATE.tolerancia).sort((a, b) => a.day.localeCompare(b.day));
    const present = new Set(similar.map((i) => i.month));
    if (similar.length < INVESTIGATE.recorrenciaMinOcorrencias || present.size < INVESTIGATE.recorrenciaMinMeses) continue;
    const gaps = similar.slice(1).map((c, k) => diffDays(similar[k]!.day, c.day));
    const counts = months.map((m) => similar.filter((i) => i.month === m).length);
    out.push({
      tipo: g.tipo,
      chave: g.chave,
      categoria: similar[0]!.p.category,
      forma: similar[0]!.p.payment,
      valor_tipico_cents: cents(mid),
      ocorrencias: similar.length,
      meses_presentes: present.size,
      meses_no_periodo: months.length,
      vezes_por_mes: counts,
      intervalo_mediano_dias: gaps.length ? median(gaps) : null,
      dias_do_mes: [...new Set(similar.map((i) => i.day.slice(8)))].sort(),
      dias_da_semana: [...new Set(similar.map((i) => weekdayOf(i.day)))],
      media_ultimos_3_cents: cents(recentMonthly(ctx, similar)),
      ja_e_conta_fixa: similar.every((i) => i.p.type === "fixa"),
      fora_do_padrao: g.items.length - similar.length,
    });
  }
  return out.sort((a, b) => b.media_ultimos_3_cents - a.media_ultimos_3_cents).slice(0, INVESTIGATE.maxGrupos);
}

/** Dias acima de 3x a média diária e o que tem dentro. */
export function peaks(ctx: Ctx, items: readonly Item[], label: (i: Item) => string) {
  const perDay = new Map<string, Item[]>();
  for (const i of items) (perDay.get(i.day) ?? perDay.set(i.day, []).get(i.day)!).push(i);
  const mean = sumCents(items) / (ctx.allDays.length || 1);
  const list = [...perDay]
    .filter(([, its]) => sumCents(its) > INVESTIGATE.picoMultiplo * mean)
    .sort((a, b) => sumCents(b[1]) - sumCents(a[1]))
    .slice(0, INVESTIGATE.maxGrupos)
    .map(([d, its]) => ({
      dia: d,
      dia_da_semana: weekdayOf(d),
      compras: its.length,
      total_cents: cents(sumCents(its)),
      maiores: [...its].sort((a, b) => b.cents - a.cents).slice(0, 3).map((i) => ({ nome: label(i), categoria: i.p.category, cents: i.cents, tipo: i.p.type })),
    }));
  return { media_diaria_cents: cents(mean), multiplo: INVESTIGATE.picoMultiplo, picos: list };
}

export function transactions(items: readonly Item[], label: (i: Item) => string, limit: number) {
  const sorted = [...items].sort((a, b) => b.day.localeCompare(a.day) || b.cents - a.cents);
  return {
    total_linhas: items.length,
    total_cents: cents(sumCents(items)),
    cortado: items.length > limit,
    linhas: sorted.slice(0, limit).map((i) => ({
      data: i.day,
      nome: label(i),
      categoria: i.p.category,
      conta: i.p.card ?? i.p.account,
      forma: i.p.payment,
      tipo: i.p.type,
      valor_cents: i.cents,
    })),
  };
}

export const SEQUENCE_MIN_TRIGGERS = 5;
const isAgenda = (i: Item) => i.p.type === "fixa" || i.p.type === "parcela";

/**
 * Depois de uma compra de A, vem uma de B em até `days` dias? Fixa e parcela
 * ficam fora dos dois lados: têm data marcada, não são comportamento. O
 * esperado é a taxa de base (dias da janela com B nos `days` seguintes); sem
 * ela, categoria frequente pareceria "sempre depois".
 */
export function sequence(
  ctx: Ctx,
  triggers: readonly Item[],
  followers: readonly Item[],
  opts: { days: number; minCents: number | null; category: string },
  label: (i: Item) => string,
) {
  const { days } = opts;
  const b = followers.filter((i) => !isAgenda(i)).sort((x, y) => x.day.localeCompare(y.day));
  // Janela que não cabe no período não conta: o fim do período não "tem" B por falta de dados, não por comportamento.
  const lastStart = addDays(ctx.to, -days);
  const a = triggers.filter((i) => !isAgenda(i) && i.day <= lastStart && (opts.minCents === null || i.cents >= opts.minCents));
  const next = (day: string) => b.find((i) => i.day > day && i.day <= addDays(day, days));
  const pairs = a.map((t) => ({ t, f: next(t.day) }));
  const followed = pairs.filter((p) => p.f);
  const start = listDays(ctx.from, lastStart);
  const expected = start.length ? start.filter((d) => next(d)).length / start.length : null;
  const share = a.length ? followed.length / a.length : null;
  const inWindows = new Set<Item>();
  for (const t of a) for (const i of b) if (i.day > t.day && i.day <= addDays(t.day, days)) inWindows.add(i);
  return {
    gatilho: { compras: a.length, valor_minimo_cents: opts.minCents },
    depois: { categoria: opts.category, dias: days },
    seguidas: followed.length,
    parte: round4(share),
    esperado: round4(expected),
    indice: share !== null && expected ? round4(share / expected) : null,
    gasto_b_nas_janelas_cents: cents(sumCents([...inWindows])),
    gasto_b_total_cents: cents(sumCents(b)),
    exemplos: followed.slice(0, 5).map(({ t, f }) => ({ dia_gatilho: t.day, rotulo_gatilho: label(t), dia_b: f!.day, rotulo_b: label(f!) })),
  };
}

/** Contexto das operações: o mesmo de padroes, só com as compras do escopo. */
export function investigationContext(input: InvestigateInput): Ctx {
  return buildContext(input);
}

export type FutureInstallment = { key: string; cents: bigint; month: string; lastMonth: string };

/**
 * Parcelas já assumidas nos próximos meses (a lista da projeção, nada
 * recalculado): total e séries por mês, e quantas terminam em cada mês.
 */
export function futureInstallments(list: readonly FutureInstallment[], fromMonth: string, months: number) {
  const out: { mes: string; parcelas_cents: number; series: number; terminam: number }[] = [];
  const all = [...new Set(list.map((l) => l.month))].filter((m) => m >= fromMonth).sort().slice(0, months);
  for (const m of all) {
    const mine = list.filter((l) => l.month === m);
    out.push({
      mes: m,
      parcelas_cents: Number(mine.reduce((s, l) => s + l.cents, 0n)),
      series: new Set(mine.map((l) => l.key)).size,
      terminam: new Set(mine.filter((l) => l.lastMonth === m).map((l) => l.key)).size,
    });
  }
  return out;
}

/** Compras parceladas novas por mês fechado (parcela 1 de n), para ver se o ritmo cresce. */
export function newInstallmentsPerMonth(ctx: Ctx, items: readonly Item[]) {
  return monthsOf(ctx.allDays).map((m) => {
    const starts = items.filter((i) => i.month === m && i.p.installmentStart);
    return { mes: m, novas: starts.length, parcela_mensal_nova_cents: cents(sumCents(starts)) };
  });
}
