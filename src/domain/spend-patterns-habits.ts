// Análises de hábito (2, 3, 4, 5, 7 e 9): evolução, lugares, compras pequenas,
// recorrência escondida, comprometimento e forma de pagamento.
import { diffDays } from "./day.ts";
import {
  LIMITS,
  byHalf,
  groupsOf,
  makeHighlight,
  placeOf,
  sumCents,
  toReais,
  umaAMenos,
  type Ctx,
  type Found,
  type Item,
  type Recorte,
} from "./spend-patterns-core.ts";
import { check, type RejectReason } from "./spend-patterns-trace.ts";
import type { AnalysisId, Group } from "./spend-patterns-core.ts";

const ALL: Recorte[] = ["casa", "categoria", "etiqueta", "conta", "lugar", "pagamento"];
const CASA = { tipo: "casa" as const, chave: "casa" };
const thinBase = (ctx: Ctx, analise: AnalysisId, g: Group, minimo: number = LIMITS.minRecorteCompras) =>
  ctx.trace?.add({ analise, recorte: { tipo: g.tipo, chave: g.chave }, motivo: "insufficient_base", base: g.items,
    checks: [check("compras_no_recorte", g.items.length, minimo, false)] });
const monthsOf = (days: readonly string[]): string[] => [...new Set(days.map((d) => d.slice(0, 7)))];
const monthTotals = (items: readonly Item[], months: readonly string[]): number[] =>
  months.map((m) => sumCents(items.filter((i) => i.month === m)));

export function analyzeTrend(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const m = [monthsOf(ctx.days[0]), monthsOf(ctx.days[1])] as const;
  if (m[0].length < 1 || m[1].length < 2) {
    ctx.trace?.add({ analise: "tendencia", recorte: CASA, motivo: "insufficient_months", base: ctx.avulso,
      checks: [check("meses_metade_anterior", m[0].length, 1, m[0].length >= 1), check("meses_metade_recente", m[1].length, 2, m[1].length >= 2)] });
    return res;
  }
  for (const g of groupsOf(ctx.avulso, ALL)) {
    const recorte = { tipo: g.tipo, chave: g.chave };
    if (g.items.length < LIMITS.minRecorteCompras) {
      thinBase(ctx, "tendencia", g);
      continue;
    }
    res.evaluated++;
    const [o, r] = [byHalf(g.items, 0), byHalf(g.items, 1)];
    const serie = ctx.trace ? monthTotals(g.items, [...m[0], ...m[1]]) : [];
    if (o.length < LIMITS.minCorteCompras || r.length < LIMITS.minCorteCompras) {
      ctx.trace?.add({ analise: "tendencia", recorte, motivo: "insufficient_subset", base: g.items, cut: r,
        checks: [check("compras_metade_anterior", o.length, LIMITS.minCorteCompras, o.length >= LIMITS.minCorteCompras),
          check("compras_metade_recente", r.length, LIMITS.minCorteCompras, r.length >= LIMITS.minCorteCompras)],
        evidencia: { meses: [...m[0], ...m[1]], gasto_por_mes_cents: serie } });
      continue;
    }
    const oMonth = sumCents(o) / m[0].length;
    const monthly = monthTotals(r, m[1]);
    const rMonth = sumCents(r) / m[1].length;
    const change = rMonth / oMonth - 1;
    // Sem o mês mais extremo da metade recente a diferença tem que continuar.
    const rise = change > 0;
    const extreme = rise ? Math.max(...monthly) : Math.min(...monthly);
    const rest = (sumCents(r) - extreme) / (m[1].length - 1);
    const freq = r.length / m[1].length / (o.length / m[0].length) - 1;
    const avg = sumCents(r) / r.length / (sumCents(o) / o.length) - 1;
    const strong = Math.abs(change) >= LIMITS.tendenciaMin;
    const robust = !(rise ? rest < oMonth * LIMITS.indiceMetade : rest > oMonth / LIMITS.indiceMetade);
    const f = Math.abs(freq) >= LIMITS.tendenciaMin;
    const v = Math.abs(avg) >= LIMITS.tendenciaMin;
    const driver = f && !v ? "frequência" : v && !f ? "valor médio" : "frequência e valor médio";
    const corte = `${rise ? "alta" : "queda"} por ${driver}`;
    const reason: RejectReason | null = !strong ? "below_threshold" : !robust ? "outlier_sensitive" : null;
    ctx.trace?.add({
      analise: "tendencia",
      recorte,
      motivo: reason,
      corte: reason ? null : corte,
      base: g.items,
      cut: r,
      checks: [
        check("variacao", change, LIMITS.tendenciaMin, strong),
        check("media_sem_mes_extremo_cents", rest, rise ? oMonth * LIMITS.indiceMetade : oMonth / LIMITS.indiceMetade, robust),
      ],
      evidencia: {
        meses: [...m[0], ...m[1]],
        gasto_por_mes_cents: serie,
        media_mes_anterior_cents: oMonth,
        media_mes_recente_cents: rMonth,
        variacao_frequencia: freq,
        variacao_valor_medio: avg,
        compras_por_mes: [o.length / m[0].length, r.length / m[1].length],
        valor_medio_cents: [sumCents(o) / o.length, sumCents(r) / r.length],
      },
    });
    if (reason) continue;
    res.found.push(
      makeHighlight("tendencia", g, corte, r, {
        indice: rMonth / oMonth,
        metades: [oMonth, rMonth],
        alavancas: [
          ...(rise ? [{ tipo: "voltar_ao_nivel_anterior" as const, cents: toReais(rMonth - oMonth) }] : []),
          ...umaAMenos(g.items, ctx),
        ],
        emJogo: Math.abs(rMonth - oMonth),
      }),
    );
  }
  return res;
}

export function analyzePlaces(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  for (const g of groupsOf(ctx.avulso, ["categoria", "etiqueta"])) {
    const places = new Map<string, Item[]>();
    for (const i of g.items) {
      const p = placeOf(i.p.label);
      if (p) places.set(p, [...(places.get(p) ?? []), i]);
    }
    if (g.items.length < LIMITS.minRecorteCompras || places.size < LIMITS.minLugaresDistintos) {
      if (g.items.length < LIMITS.minRecorteCompras) thinBase(ctx, "lugares", g);
      else
        ctx.trace?.add({ analise: "lugares", recorte: { tipo: g.tipo, chave: g.chave }, motivo: "insufficient_base", base: g.items,
          checks: [check("lugares_distintos", places.size, LIMITS.minLugaresDistintos, false)] });
      continue;
    }
    res.evaluated++;
    const top = [...places]
      .sort((a, b) => b[1].length - a[1].length || sumCents(b[1]) - sumCents(a[1]) || a[0].localeCompare(b[0]))
      .slice(0, LIMITS.topLugares);
    const cut = top.flatMap(([, its]) => its);
    const share = sumCents(cut) / sumCents(g.items);
    const halves = ([0, 1] as const).map((h) => {
      const total = sumCents(byHalf(g.items, h));
      return total ? sumCents(byHalf(cut, h)) / total : 0;
    }) as [number, number];
    const halfMin = LIMITS.topLugaresMin / LIMITS.indiceMetade;
    const reason: RejectReason | null =
      cut.length < LIMITS.minCorteCompras ? "insufficient_subset"
      : share < LIMITS.topLugaresMin ? "below_threshold"
      : halves.some((s) => s < halfMin) ? "not_persistent"
      : null;
    const corte = top.map(([p]) => p).join(", ");
    ctx.trace?.add({
      analise: "lugares",
      recorte: { tipo: g.tipo, chave: g.chave },
      motivo: reason,
      corte: reason ? null : corte,
      base: g.items,
      cut,
      checks: [
        check("compras_nos_lugares", cut.length, LIMITS.minCorteCompras, cut.length >= LIMITS.minCorteCompras),
        check("parte_dos_lugares", share, LIMITS.topLugaresMin, share >= LIMITS.topLugaresMin),
        check("parte_metade_anterior", halves[0], halfMin, halves[0] >= halfMin),
        check("parte_metade_recente", halves[1], halfMin, halves[1] >= halfMin),
      ],
      // Só os lugares que mais pesam: nome, contagem e total (sem descrição completa).
      evidencia: {
        lugares_distintos: places.size,
        principais: [...places]
          .sort((a, b) => sumCents(b[1]) - sumCents(a[1]) || a[0].localeCompare(b[0]))
          .slice(0, 10)
          .map(([p, its]) => ({ lugar: p, compras: its.length, cents: sumCents(its) })),
      },
    });
    if (reason) continue;
    res.found.push(
      makeHighlight("lugares", g, corte, cut, {
        indice: share,
        metades: halves,
        alavancas: umaAMenos(cut, ctx),
        emJogo: sumCents(cut) / ctx.nMonths,
      }),
    );
  }
  return res;
}

export function analyzeSmallPurchases(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const m = [monthsOf(ctx.days[0]), monthsOf(ctx.days[1])] as const;
  for (const g of groupsOf(ctx.avulso, ALL)) {
    if (g.items.length < LIMITS.minRecorteCompras) {
      thinBase(ctx, "compras_pequenas", g);
      continue;
    }
    res.evaluated++;
    // Teto fixo: com o quartil, compras todas iguais (o pão de todo dia) nunca contavam.
    const cut = g.items.filter((i) => i.cents <= LIMITS.pequenaCents);
    const monthly = sumCents(cut) / ctx.nMonths;
    const halves = [sumCents(byHalf(cut, 0)) / (m[0].length || 1), sumCents(byHalf(cut, 1)) / (m[1].length || 1)] as [number, number];
    const halfMin = LIMITS.pequenasMensalMinCents / LIMITS.indiceMetade;
    const reason: RejectReason | null =
      cut.length < LIMITS.minCorteCompras ? "insufficient_subset"
      : monthly < LIMITS.pequenasMensalMinCents ? "below_threshold"
      : halves.some((h) => h < halfMin) ? "not_persistent"
      : null;
    ctx.trace?.add({
      analise: "compras_pequenas",
      recorte: { tipo: g.tipo, chave: g.chave },
      motivo: reason,
      corte: reason ? null : "compras pequenas",
      base: g.items,
      cut,
      checks: [
        check("compras_pequenas", cut.length, LIMITS.minCorteCompras, cut.length >= LIMITS.minCorteCompras),
        check("total_por_mes_cents", monthly, LIMITS.pequenasMensalMinCents, monthly >= LIMITS.pequenasMensalMinCents),
        check("por_mes_metade_anterior_cents", halves[0], halfMin, halves[0] >= halfMin),
        check("por_mes_metade_recente_cents", halves[1], halfMin, halves[1] >= halfMin),
      ],
      evidencia: { teto_cents: LIMITS.pequenaCents },
    });
    if (reason) continue;
    res.found.push(
      makeHighlight("compras_pequenas", g, "compras pequenas", cut, {
        indice: null,
        metades: halves,
        alavancas: [{ tipo: "compras_pequenas_pela_metade", cents: toReais(monthly / 2) }],
      }),
    );
  }
  return res;
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const within = (xs: readonly number[], [lo, hi]: readonly [number, number]): boolean => xs.every((x) => x >= lo && x <= hi);

export function analyzeHiddenRecurrence(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const fixed = new Set(ctx.items.filter((i) => i.p.type === "fixa").map((i) => i.p.label.trim()));
  for (const g of groupsOf(ctx.avulso, ["lugar"])) {
    const recorte = { tipo: g.tipo, chave: g.chave };
    if (g.items.length < LIMITS.recorrenciaMinOcorrencias || fixed.has(g.chave)) {
      if (fixed.has(g.chave))
        ctx.trace?.add({ analise: "recorrencia_escondida", recorte, motivo: "already_fixed", base: g.items });
      else thinBase(ctx, "recorrencia_escondida", g, LIMITS.recorrenciaMinOcorrencias);
      continue;
    }
    res.evaluated++;
    const mid = median(g.items.map((i) => i.cents));
    const cut = g.items
      .filter((i) => Math.abs(i.cents - mid) <= mid * LIMITS.recorrenciaTolerancia)
      .sort((a, b) => a.day.localeCompare(b.day));
    const gaps = cut.slice(1).map((c, k) => diffDays(cut[k]!.day, c.day));
    const monthly = within(gaps, LIMITS.recorrenciaMensalDias);
    const weekly = within(gaps, LIMITS.recorrenciaSemanalDias);
    const halves = [byHalf(cut, 0).length, byHalf(cut, 1).length] as [number, number];
    const reason: RejectReason | null =
      cut.length < LIMITS.recorrenciaMinOcorrencias ? "insufficient_subset"
      : !monthly && !weekly ? "irregular_interval"
      : halves.some((n) => n < LIMITS.recorrenciaMinPorMetade) ? "not_persistent"
      : null;
    ctx.trace?.add({
      analise: "recorrencia_escondida",
      recorte,
      motivo: reason,
      corte: reason ? null : monthly ? "todo mês" : "toda semana",
      base: g.items,
      cut,
      checks: [
        check("cobrancas_parecidas", cut.length, LIMITS.recorrenciaMinOcorrencias, cut.length >= LIMITS.recorrenciaMinOcorrencias),
        check("intervalo_mensal", monthly ? "sim" : "não", `${LIMITS.recorrenciaMensalDias.join("-")} dias`, monthly),
        check("intervalo_semanal", weekly ? "sim" : "não", `${LIMITS.recorrenciaSemanalDias.join("-")} dias`, weekly),
        check("cobrancas_metade_anterior", halves[0], LIMITS.recorrenciaMinPorMetade, halves[0] >= LIMITS.recorrenciaMinPorMetade),
        check("cobrancas_metade_recente", halves[1], LIMITS.recorrenciaMinPorMetade, halves[1] >= LIMITS.recorrenciaMinPorMetade),
      ],
      evidencia: { valor_tipico_cents: mid, tolerancia: LIMITS.recorrenciaTolerancia, datas: cut.map((c) => c.day), intervalos_dias: gaps },
    });
    if (reason) continue;
    const perMonth = monthly ? mid : (mid * 52) / 12;
    res.found.push(
      makeHighlight("recorrencia_escondida", g, monthly ? "todo mês" : "toda semana", cut, {
        indice: null,
        metades: halves,
        alavancas: [{ tipo: "cancelar_recorrencia", cents: toReais(perMonth) }],
      }),
    );
  }
  return res;
}

export function analyzeCommitment(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const m = [monthsOf(ctx.days[0]), monthsOf(ctx.days[1])] as const;
  const group = { tipo: "casa" as const, chave: "casa", items: ctx.items };
  const fixed = ctx.items.filter((i) => i.p.type === "fixa" || i.p.type === "parcela");
  const perMonth = (items: readonly Item[], h: 0 | 1) => sumCents(byHalf(items, h)) / (m[h].length || 1);
  if (ctx.income) {
    res.evaluated++;
    const share = sumCents(fixed) / ctx.nMonths / ctx.income;
    const halves = [perMonth(fixed, 0) / ctx.income, perMonth(fixed, 1) / ctx.income] as [number, number];
    const halfMin = LIMITS.comprometimentoMin / LIMITS.indiceMetade;
    const reason: RejectReason | null =
      share < LIMITS.comprometimentoMin ? "below_threshold" : halves.some((s) => s < halfMin) ? "not_persistent" : null;
    ctx.trace?.add({
      analise: "comprometimento", recorte: CASA, variante: "contas fixas e parcelas", motivo: reason,
      corte: reason ? null : "contas fixas e parcelas", base: ctx.items, cut: fixed,
      checks: [
        check("parte_da_renda", share, LIMITS.comprometimentoMin, share >= LIMITS.comprometimentoMin),
        check("parte_metade_anterior", halves[0], halfMin, halves[0] >= halfMin),
        check("parte_metade_recente", halves[1], halfMin, halves[1] >= halfMin),
      ],
      evidencia: { renda_media_cents: ctx.income, fixas_e_parcelas_por_mes_cents: sumCents(fixed) / ctx.nMonths },
    });
    if (!reason) {
      res.found.push(
        makeHighlight("comprometimento", group, "contas fixas e parcelas", fixed, {
          indice: share,
          metades: halves,
          alavancas: [],
          emJogo: sumCents(fixed) / ctx.nMonths,
        }),
      );
    }
  } else {
    ctx.trace?.add({ analise: "comprometimento", recorte: CASA, variante: "contas fixas e parcelas", motivo: "no_income", base: ctx.items, cut: fixed });
  }
  res.evaluated++;
  const starts = ctx.items.filter((i) => i.p.installmentStart);
  const rate = starts.length / ctx.nMonths;
  const halves = [byHalf(starts, 0).length / (m[0].length || 1), byHalf(starts, 1).length / (m[1].length || 1)] as [number, number];
  const rateHalfMin = LIMITS.parcelasNovasPorMes / LIMITS.indiceMetade;
  const startsReason: RejectReason | null =
    starts.length < LIMITS.minCorteCompras ? "insufficient_subset"
    : rate < LIMITS.parcelasNovasPorMes ? "below_threshold"
    : halves.some((r) => r < rateHalfMin) ? "not_persistent"
    : null;
  ctx.trace?.add({
    analise: "comprometimento", recorte: CASA, variante: "parcelamentos novos por mês", motivo: startsReason,
    corte: startsReason ? null : "parcelamentos novos por mês", base: ctx.items, cut: starts,
    checks: [
      check("parcelamentos_novos", starts.length, LIMITS.minCorteCompras, starts.length >= LIMITS.minCorteCompras),
      check("por_mes", rate, LIMITS.parcelasNovasPorMes, rate >= LIMITS.parcelasNovasPorMes),
      check("por_mes_metade_anterior", halves[0], rateHalfMin, halves[0] >= rateHalfMin),
      check("por_mes_metade_recente", halves[1], rateHalfMin, halves[1] >= rateHalfMin),
    ],
  });
  if (!startsReason) {
    res.found.push(
      makeHighlight("comprometimento", group, "parcelamentos novos por mês", starts, {
        indice: rate,
        metades: halves,
        alavancas: [],
        emJogo: sumCents(starts) / ctx.nMonths,
      }),
    );
  }
  return res;
}

export function analyzePaymentMix(ctx: Ctx): Found {
  const res: Found = { found: [], evaluated: 0 };
  const m = [monthsOf(ctx.days[0]), monthsOf(ctx.days[1])] as const;
  if (m[1].length < 2) {
    ctx.trace?.add({ analise: "forma_pagamento", recorte: CASA, motivo: "insufficient_months", base: ctx.avulso,
      checks: [check("meses_metade_recente", m[1].length, 2, false)] });
    return res;
  }
  const share = (items: readonly Item[], pay: string) => {
    const total = sumCents(items);
    return total ? sumCents(items.filter((i) => i.p.payment === pay)) / total : 0;
  };
  for (const g of groupsOf(ctx.avulso, ["casa", "categoria", "etiqueta", "conta", "lugar"])) {
    const recorte = { tipo: g.tipo, chave: g.chave };
    if (g.items.length < LIMITS.minRecorteCompras) {
      thinBase(ctx, "forma_pagamento", g);
      continue;
    }
    res.evaluated++;
    const [o, r] = [byHalf(g.items, 0), byHalf(g.items, 1)];
    if (o.length < LIMITS.minCorteCompras || r.length < LIMITS.minCorteCompras) {
      ctx.trace?.add({ analise: "forma_pagamento", recorte, motivo: "insufficient_subset", base: g.items,
        checks: [check("compras_metade_anterior", o.length, LIMITS.minCorteCompras, o.length >= LIMITS.minCorteCompras),
          check("compras_metade_recente", r.length, LIMITS.minCorteCompras, r.length >= LIMITS.minCorteCompras)] });
      continue;
    }
    const ranked = (["credito", "pix", "debito"] as const)
      .map((pay) => ({ pay, a: share(o, pay), b: share(r, pay) }))
      .sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0]!;
    const diff = ranked.b - ranked.a;
    // Evidência para a auditoria: a parte de cada forma e o gasto total por mês nas duas metades
    // (a forma de pagamento mudar não diz se o gasto mudou).
    const evidencia = () => ({
      partes: (["credito", "pix", "debito"] as const).map((pay) => ({ forma: pay, anterior: share(o, pay), recente: share(r, pay) })),
      gasto_por_mes_cents: [sumCents(o) / m[0].length, sumCents(r) / m[1].length],
    });
    const turnMin = LIMITS.pagamentoMudancaMin;
    if (Math.abs(diff) < turnMin) {
      ctx.trace?.add({ analise: "forma_pagamento", recorte, variante: ranked.pay, motivo: "below_threshold", base: g.items,
        checks: [check("mudanca_da_parte", diff, turnMin, false)], evidencia: evidencia() });
      continue;
    }
    // Sem o mês mais extremo da metade recente a mudança tem que continuar.
    const perMonth = m[1].map((mo) => r.filter((i) => i.month === mo));
    const pick = perMonth
      .map((its) => sumCents(its.filter((i) => i.p.payment === ranked.pay)))
      .reduce((best, v, k, all) => ((diff > 0 ? v > all[best]! : v < all[best]!) ? k : best), 0);
    const kept = perMonth.filter((_, k) => k !== pick).flat();
    const robust = share(kept, ranked.pay) - ranked.a;
    const corte = `${ranked.pay} ${diff > 0 ? "subiu" : "caiu"}`;
    const cut = r.filter((i) => i.p.payment === ranked.pay);
    const fragile = Math.abs(robust) < turnMin / LIMITS.indiceMetade || robust * diff < 0;
    ctx.trace?.add({
      analise: "forma_pagamento", recorte, variante: ranked.pay, motivo: fragile ? "outlier_sensitive" : null,
      corte: fragile ? null : corte, base: g.items, cut,
      checks: [
        check("mudanca_da_parte", diff, turnMin, true),
        check("mudanca_sem_mes_extremo", robust, turnMin / LIMITS.indiceMetade, !fragile),
      ],
      evidencia: evidencia(),
    });
    if (fragile) continue;
    res.found.push(
      makeHighlight("forma_pagamento", g, corte, cut, {
        indice: null,
        metades: [ranked.a, ranked.b],
        alavancas: [],
        emJogo: Math.abs(diff) * (sumCents(r) / m[1].length),
      }),
    );
  }
  return res;
}
