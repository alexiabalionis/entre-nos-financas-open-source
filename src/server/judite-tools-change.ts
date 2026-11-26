// Ferramenta simular_mudanca (SPEC-JUDITE-INVESTIGACAO, M3): compara uma
// mudança hipotética com o cenário atual. Custo pelo histórico das compras do
// alvo (média dos 3 últimos meses fechados); caixa e faturas por projectFuture
// com applyScenario, o mesmo motor da aba Simular. Nada é gravado: o cenário
// só existe nesta chamada.
import { shiftMonth } from "../domain/card-cycle.ts";
import {
  CASH_MONTHS,
  baselineOf,
  cashCompare,
  commitmentCompare,
  costChange,
  datedShocks,
  type CostChange,
} from "../domain/change-simulate.ts";
import { applyScenario, projectFuture, type Scenario } from "../domain/future-months.ts";
import { normalizeSearch } from "../domain/memory-search.ts";
import { recurrences } from "../domain/spend-investigate.ts";
import { settledToday } from "./bank-settled.ts";
import { UserError } from "./imports.ts";
import { centsAsText, resolveScope } from "./judite-tools-investigate.ts";
import type { ToolCall, ToolDeps } from "./judite-tools-schema.ts";

type Call = Extract<ToolCall, { name: "simular_mudanca" }>;
const NOTHING_SAVED = "Simulação: nada foi salvo nem mudado no aplicativo.";

const hasTarget = (c: Call) =>
  [c.categoria, c.conta, c.etiqueta, c.lugar, c.destinatario, c.pagamento, c.padrao].some((v) => v !== undefined);

export async function changeTool(deps: ToolDeps, call: Call): Promise<unknown> {
  const out = (await simulateChange(deps, call)) as Record<string, unknown>;
  // Ref sN (contagem própria): as hipóteses do diagnóstico apontam para a simulação que sustenta um benefício.
  const ref = `s${[...deps.patternRefs.keys()].filter((k) => k.startsWith("s")).length}`;
  deps.patternRefs.set(ref, { analise: "simular_mudanca", corte: String(out.tipo_de_resultado ?? ""), recorte: { tipo: "simulacao", chave: ref } });
  return { ref, ...out };
}

async function simulateChange(deps: ToolDeps, call: Call): Promise<unknown> {
  const m = call.mudanca;
  const { input, result } = await deps.futurePlan();
  // O mês atual já começou: o caixa comparado são os próximos meses inteiros.
  const next = shiftMonth(input.startMonth, 1);

  if (m.tipo === "conta_fixa") {
    if (m.novo_valor_cents === undefined && m.novo_dia === undefined) throw new UserError("Diga o valor novo ou o dia novo da conta fixa.");
    const wanted = normalizeSearch(m.conta_fixa);
    const labels = [...new Set(input.fixed.flatMap((x) => x.items.map((l) => l.label)))];
    const label = labels.find((l) => normalizeSearch(l) === wanted) ?? labels.find((l) => normalizeSearch(l).includes(wanted));
    if (!label) throw new UserError(`Não achei a conta fixa "${m.conta_fixa}" no planejamento dos próximos meses.`);
    const current = input.fixed.find((x) => x.month >= next && x.items.some((l) => l.label === label))?.items.find((l) => l.label === label);
    const scenario: Scenario = {
      fixedEdits: [{ label, fromMonth: next, ...(m.novo_valor_cents ? { cents: BigInt(m.novo_valor_cents) } : {}), ...(m.novo_dia ? { day: m.novo_dia } : {}) }],
    };
    const after = projectFuture(applyScenario(input, scenario));
    const now = Number(current?.cents ?? 0n);
    const newCost = m.novo_valor_cents ? Number(m.novo_valor_cents) : now;
    return centsAsText({
      aviso: NOTHING_SAVED,
      alvo: { conta_fixa: label, a_partir_de: next },
      tipo_de_resultado: m.novo_valor_cents ? "economia_calculada" : "fluxo_de_caixa",
      condicao: m.novo_valor_cents ? "vale se o valor novo for o preço confirmado" : "o custo é o mesmo: muda o vencimento",
      custo_mensal_atual_cents: now,
      custo_mensal_novo_cents: newCost,
      diferenca_mensal_cents: now - newCost,
      diferenca_anual_estimada_cents: (now - newCost) * 12,
      caixa: { relativo: false, sem_dia_a_dia: true, meses: cashCompare(result, after, next, CASH_MONTHS) },
    });
  }

  if (m.tipo === "compra") {
    const cardName = call.conta !== undefined ? deps.catalog.accounts[Number(call.conta.slice(1))]?.name : undefined;
    const day = m.dia ?? settledToday();
    let scenario: Scenario;
    if (m.forma === "credito") {
      const card = (cardName ? input.cards.find((c) => c.name === cardName) : input.cards[0]) ?? null;
      if (!card) throw new UserError("Não há cartão com fatura no planejamento para simular a compra no crédito.");
      scenario = { purchases: [{ card: card.card, cents: BigInt(m.valor_cents), installments: m.parcelas, day, label: "Compra simulada" }] };
    } else {
      if (m.parcelas !== 1) throw new UserError("No débito a compra sai de uma vez: use parcelas 1.");
      scenario = { shocks: [{ kind: "despesa", month: day.slice(0, 7), months: 1, cents: BigInt(m.valor_cents), label: "Compra simulada", day: Number(day.slice(8)) }] };
    }
    const after = projectFuture(applyScenario(input, scenario));
    return centsAsText({
      aviso: NOTHING_SAVED,
      tipo_de_resultado: "comprometimento_futuro",
      compra: { valor_cents: Number(m.valor_cents), parcelas: m.parcelas, forma: m.forma, dia: day },
      premissas: after.premises.filter((p) => p.startsWith("Compra simulada")),
      por_mes: commitmentCompare(result, after, Math.min(input.months, 12)),
      sem_dia_a_dia: true,
    });
  }

  if (!hasTarget(call)) throw new UserError("Diga sobre qual gasto é a mudança (categoria, lugar, destinatário ou conta).");
  const { ctx, escopo, data } = await resolveScope(deps, call);
  const items = ctx.items;
  const base = baselineOf(ctx, items);
  if (!items.length || base.custo_mensal_cents === 0) throw new UserError("Esse gasto não aparece nos últimos 3 meses fechados.");
  let change: CostChange;
  if (m.tipo === "cancelar") {
    // O alvo precisa SER o pagamento que se repete: todas as compras dele no mesmo valor, em pelo menos 3 meses.
    const rec = recurrences(ctx, items, data.recipients)[0];
    if (!rec || rec.meses_presentes < 3 || rec.fora_do_padrao > 0 || rec.ocorrencias !== items.length)
      throw new UserError("Cancelar só se simula para um pagamento que se repete todo mês com o mesmo valor (filtre pelo lugar ou destinatário dele).");
    change = { tipo: "cancelar", recorrenteCents: Number(rec.media_ultimos_3_cents) };
  } else if (m.tipo === "desconto") change = { tipo: "desconto", pct: m.pct };
  else if (m.tipo === "reduzir_frequencia") change = { tipo: "reduzir_frequencia", vezes: m.vezes_a_menos_por_mes };
  else if (m.tipo === "teto") change = { tipo: "teto", tetoCents: Number(m.teto_cents) };
  else change = { tipo: "concentrar_pagamentos", dia: m.dia, ...(m.desconto_pct ? { descontoPct: m.desconto_pct } : {}) };
  const cost = costChange(base, change);
  const out: Record<string, unknown> = {
    aviso: NOTHING_SAVED,
    alvo: escopo,
    base: {
      meses: base.meses,
      compras_por_mes: base.compras_por_mes,
      ticket_medio_cents: base.ticket_medio_cents,
      fonte: "média dos últimos 3 meses fechados",
    },
    ...cost,
  };
  if (m.tipo === "concentrar_pagamentos" && base.ultimo_mes) {
    // Caixa relativo: o padrão de datas atual e o novo, os dois injetados na projeção.
    const nowPays = base.ultimo_mes.pagamentos;
    // Mesmo total do mês de referência (com o desconto, se houver): a diferença de caixa vem só das datas e do desconto.
    const single = Math.round(nowPays.reduce((t, p) => t + p.cents, 0) * (1 - (m.desconto_pct ?? 0) / 100));
    const before = projectFuture(applyScenario(input, { shocks: datedShocks(nowPays, next, CASH_MONTHS, "Pagamento atual") }));
    const after = projectFuture(
      applyScenario(input, { shocks: datedShocks([{ dia: m.dia, cents: single }], next, CASH_MONTHS, "Pagamento único") }),
    );
    out.caixa = {
      relativo: true,
      sem_dia_a_dia: true,
      leia_assim: "só a diferença vale; o saldo absoluto não inclui o dia a dia",
      padrao_atual: { mes_de_referencia: base.ultimo_mes.mes, dias: nowPays.map((p) => p.dia) },
      padrao_novo: { dias: [m.dia] },
      meses: cashCompare(before, after, next, CASH_MONTHS),
    };
  }
  return centsAsText(out);
}
