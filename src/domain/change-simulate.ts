// Simulação de mudança (puro, SPEC-JUDITE-INVESTIGACAO M3). Nada aqui grava e
// nada aqui é um segundo motor: o custo vem do histórico das compras (a média
// dos últimos 3 meses fechados, decisão de 22/11/2026) e o caixa vem de
// projectFuture, chamado pelo servidor duas vezes.
//
// Regras de rótulo (decisão de 22/11/2026):
//  - economia_calculada: mudança única com preço conhecido (cancelar algo que se
//    repete; conta fixa com valor novo informado);
//  - economia_hipotetica: depende de uma condição (desconto a confirmar; teto ou
//    frequência a manter);
//  - fluxo_de_caixa: muda datas, não o custo (o caixa é comparado de forma
//    RELATIVA: as duas versões injetadas na projeção, que não tem o dia a dia);
//  - comprometimento_futuro: compra nova que ocupa faturas ou o caixa dos próximos meses.
import { shiftMonth } from "./card-cycle.ts";
import type { FutureResult, Shock } from "./future-months.ts";
import { sumCents, type Ctx, type Item } from "./spend-patterns-core.ts";

export type ResultKind = "economia_calculada" | "economia_hipotetica" | "fluxo_de_caixa" | "comprometimento_futuro";

export type CostChange =
  | { tipo: "desconto"; pct: number }
  | { tipo: "reduzir_frequencia"; vezes: number }
  | { tipo: "teto"; tetoCents: number }
  | { tipo: "cancelar"; recorrenteCents: number }
  | { tipo: "concentrar_pagamentos"; dia: number; descontoPct?: number };

export const RECENT_MONTHS = 3;
/** Horizonte do caixa comparado: os próximos meses inteiros (o atual já começou). */
export const CASH_MONTHS = 3;

export type Baseline = {
  meses: string[];
  custo_mensal_cents: number;
  compras_por_mes: number;
  ticket_medio_cents: number | null;
  /** Pagamentos do último mês fechado (dia e valor): o padrão de datas atual. */
  ultimo_mes: { mes: string; pagamentos: { dia: number; cents: number }[] } | null;
};

const monthsOf = (ctx: Ctx) => [...new Set(ctx.allDays.map((d) => d.slice(0, 7)))];

export function baselineOf(ctx: Ctx, items: readonly Item[]): Baseline {
  const months = monthsOf(ctx).slice(-RECENT_MONTHS);
  const mine = items.filter((i) => months.includes(i.month));
  const n = months.length || 1;
  const last = months[months.length - 1];
  return {
    meses: months,
    custo_mensal_cents: Math.round(sumCents(mine) / n),
    compras_por_mes: Math.round((mine.length / n) * 100) / 100,
    ticket_medio_cents: mine.length ? Math.round(sumCents(mine) / mine.length) : null,
    ultimo_mes: last
      ? {
          mes: last,
          pagamentos: mine
            .filter((i) => i.month === last)
            .sort((a, b) => a.day.localeCompare(b.day))
            .map((i) => ({ dia: Number(i.day.slice(8)), cents: i.cents })),
        }
      : null,
  };
}

export type CostResult = {
  tipo_de_resultado: ResultKind;
  condicao: string | null;
  custo_mensal_atual_cents: number;
  custo_mensal_novo_cents: number;
  diferenca_mensal_cents: number;
  /** Diferença mensal x 12: estimativa pelo passado, não promessa. */
  diferenca_anual_estimada_cents: number;
};

export function costChange(base: Baseline, change: CostChange): CostResult {
  const now = base.custo_mensal_cents;
  const ticket = base.ticket_medio_cents ?? 0;
  let next = now;
  let kind: ResultKind = "economia_hipotetica";
  let condicao: string | null = null;
  if (change.tipo === "desconto") {
    next = Math.round(now * (1 - change.pct / 100));
    condicao = `depende de confirmar um desconto de ${change.pct}% com quem recebe; até lá não é economia`;
  } else if (change.tipo === "reduzir_frequencia") {
    next = Math.max(0, Math.round(now - change.vezes * ticket));
    condicao = `depende de manter ${change.vezes} compra(s) a menos por mês, todo mês`;
  } else if (change.tipo === "teto") {
    next = Math.min(now, change.tetoCents);
    condicao = "depende de manter o gasto dentro do teto todo mês";
  } else if (change.tipo === "cancelar") {
    next = Math.max(0, now - change.recorrenteCents);
    kind = "economia_calculada";
    condicao = "vale a partir do cancelamento; confira se não há multa ou fidelidade";
  } else {
    if (change.descontoPct !== undefined) {
      next = Math.round(now * (1 - change.descontoPct / 100));
      condicao = `o custo só muda se o desconto de ${change.descontoPct}% for confirmado; sem ele, muda só a data`;
    } else {
      kind = "fluxo_de_caixa";
      condicao = "o custo é o mesmo: muda a data e o número de pagamentos";
    }
  }
  const diff = now - next;
  return {
    tipo_de_resultado: kind,
    condicao,
    custo_mensal_atual_cents: now,
    custo_mensal_novo_cents: next,
    diferenca_mensal_cents: diff,
    diferenca_anual_estimada_cents: diff * 12,
  };
}

/** Pagamentos datados virando "imprevistos" datados nos meses `from`..`from+n-1` da projeção. */
export function datedShocks(pays: readonly { dia: number; cents: number }[], from: string, months: number, label: string): Shock[] {
  return pays.map((p, k) => ({ kind: "despesa" as const, month: from, months, cents: BigInt(Math.round(p.cents)), label: `${label} ${k + 1}`, day: p.dia }));
}

/** Menor saldo de cada mês nas duas versões. Só a diferença é afirmável: a projeção não tem o dia a dia. */
export function cashCompare(before: FutureResult, after: FutureResult, from: string, months: number) {
  const out: { mes: string; menor_saldo_antes_cents: number; dia_antes: string; menor_saldo_depois_cents: number; dia_depois: string; diferenca_cents: number }[] = [];
  for (let k = 0; k < months; k++) {
    const m = shiftMonth(from, k);
    const a = before.rows.find((r) => r.month === m);
    const b = after.rows.find((r) => r.month === m);
    if (!a || !b) continue;
    out.push({
      mes: m,
      menor_saldo_antes_cents: Number(a.cash.low.cents),
      dia_antes: a.cash.low.date,
      menor_saldo_depois_cents: Number(b.cash.low.cents),
      dia_depois: b.cash.low.date,
      diferenca_cents: Number(b.cash.low.cents - a.cash.low.cents),
    });
  }
  return out;
}

/** Faturas e parcelas por mês nas duas versões (compra nova). */
export function commitmentCompare(before: FutureResult, after: FutureResult, months: number) {
  return before.rows.slice(0, months).map((a, k) => {
    const b = after.rows[k]!;
    return {
      mes: a.month,
      faturas_antes_cents: Number(a.card),
      faturas_depois_cents: Number(b.card),
      parcelas_a_vencer_antes_cents: Number(a.committed),
      parcelas_a_vencer_depois_cents: Number(b.committed),
      menor_saldo_diferenca_cents: Number(b.cash.low.cents - a.cash.low.cents),
    };
  });
}
