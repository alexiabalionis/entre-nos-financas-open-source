// Ferramenta investigar_gastos (SPEC-JUDITE-INVESTIGACAO, M2): investigação
// dirigida com operações fechadas sobre as compras dos meses fechados. Lê pela
// mesma janela de padroes (uma vez por pergunta), filtra pelo escopo pedido e
// devolve números do domínio. Sem SQL do modelo, só a casa de quem pergunta,
// limites em tudo que é lista. Nenhuma escrita.
import { shiftMonth } from "../domain/card-cycle.ts";
import { promptLabel } from "../domain/movements.ts";
import {
  comparePeriods,
  coverage,
  distribution,
  fragmentation,
  futureInstallments,
  investigationContext,
  monthlySeries,
  newInstallmentsPerMonth,
  paymentMix,
  peaks,
  recurrences,
  salaryCycles,
  sequence,
  transactions,
  INVESTIGATE,
  SEQUENCE_MIN_TRIGGERS,
} from "../domain/spend-investigate.ts";
import { placeOf, type Item } from "../domain/spend-patterns-core.ts";
import { normalizeSearch } from "../domain/memory-search.ts";
import { settledToday } from "./bank-settled.ts";
import { UserError } from "./imports.ts";
import type { ToolCall, ToolDeps } from "./judite-tools-schema.ts";

type Call = Extract<ToolCall, { name: "investigar_gastos" }>;

const DEFAULT_MONTHS = 6;
const DEFAULT_LIMIT = 20;
const FUTURE_MONTHS = 12;
const DEFAULT_SEQUENCE_DAYS = 4;

/** Centavos do domínio (number) viram texto, como nas outras ferramentas: só assim ganham *_formatted e valem como fonte. */
export function centsAsText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(centsAsText);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      (k === "cents" || k.endsWith("_cents")) && typeof v === "number" ? String(Math.trunc(v)) : centsAsText(v),
    ]),
  );
}

/** Filtros comuns de investigar_gastos e simular_mudanca. */
export type ScopeFilter = Pick<Call, "categoria" | "conta" | "etiqueta" | "lugar" | "destinatario" | "pagamento" | "padrao" | "meses">;

/** Resolve o escopo pedido sobre a janela lida uma vez: o contexto do domínio e o rótulo de cada compra. */
export async function resolveScope(deps: ToolDeps, call: ScopeFilter) {
  const pick = (list: { name: string }[] | undefined, ref: string | undefined, what: string) => {
    if (ref === undefined) return undefined;
    const found = list?.[Number(ref.slice(1))];
    if (!found) throw new UserError(`Não identifiquei ${what}. Diga o nome exato.`);
    return found.name;
  };
  const category = pick(deps.catalog.categories, call.categoria, "a categoria");
  const account = pick(deps.catalog.accounts, call.conta, "a conta");
  let ids: Set<string> | undefined;
  if (call.padrao !== undefined) {
    const ref = deps.patternRefs.get(call.padrao);
    if (!ref?.ids) throw new UserError(`O destaque ${call.padrao} não veio de padroes nesta pergunta.`);
    ids = new Set(ref.ids);
  }
  const data = await deps.spend(call.meses ?? DEFAULT_MONTHS);
  if (call.destinatario !== undefined && ![...data.recipients.values()].includes(call.destinatario))
    throw new UserError(`O destinatário ${call.destinatario} não apareceu nesta janela.`);
  const place = call.lugar ? normalizeSearch(call.lugar) : undefined;
  const tag = call.etiqueta ? normalizeSearch(call.etiqueta) : undefined;
  const scope = data.purchases.filter((p, k) => {
    const r = data.rows[k]!;
    if (category !== undefined && p.category !== category) return false;
    if (account !== undefined && r.account !== account && r.cardLabel !== account) return false;
    if (tag !== undefined && normalizeSearch(p.tag) !== tag) return false;
    if (place !== undefined && normalizeSearch(placeOf(p.label) ?? "") !== place) return false;
    if (call.destinatario !== undefined && data.recipients.get(r.id) !== call.destinatario) return false;
    if (call.pagamento !== undefined && p.payment !== call.pagamento) return false;
    if (ids !== undefined && !ids.has(r.id)) return false;
    return true;
  });
  const ctx = investigationContext({
    purchases: scope,
    accountsTime: data.extras.accountsTime,
    salaryDates: data.extras.salaryDates,
    months: data.months,
  });
  const rowById = new Map(data.rows.map((r) => [r.id, r]));
  const label = (i: Item) => {
    const r = i.p.id ? rowById.get(i.p.id) : undefined;
    const who = i.p.id ? data.recipients.get(i.p.id) : undefined;
    return r ? `${promptLabel(r)}${who ? ` (${who})` : ""}` : i.p.label;
  };
  const escopo = {
    ...(category ? { categoria: category } : {}),
    ...(account ? { conta: account } : {}),
    ...(call.etiqueta ? { etiqueta: call.etiqueta } : {}),
    ...(call.lugar ? { lugar: call.lugar } : {}),
    ...(call.destinatario ? { destinatario: call.destinatario } : {}),
    ...(call.pagamento ? { pagamento: call.pagamento } : {}),
    ...(call.padrao ? { padrao: call.padrao } : {}),
  };
  return { data, ctx, label, escopo, account };
}

const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** O que investigationTags lê de um resultado (antes ou depois de virar texto). */
export type InvestigationOut = {
  ref?: string;
  distribuicao?: { eixo: string; fatias: { fatia: string; compras: number }[] };
  ciclo_salario?: unknown;
  recorrencias?: { dias_da_semana: string[] }[];
  picos?: { picos: { dia_da_semana: string }[] };
  serie_mensal?: unknown;
  comparar_periodos?: unknown;
  forma_pagamento?: unknown;
  parcelas?: unknown;
  sequencia?: unknown;
};

/** O que um resultado sustenta, nas etiquetas de pattern-check (dia:, hora:, parte:, salario...). */
export function investigationTags(out: InvestigationOut): string[] {
  const tags = new Set<string>();
  const nonEmpty = (f: { compras: number }) => f.compras > 0;
  const d = out.distribuicao;
  if (d?.eixo === "dia_da_semana")
    for (const f of d.fatias.filter(nonEmpty)) {
      tags.add(`dia:${fold(f.fatia)}`);
      tags.add(["sábado", "domingo"].includes(f.fatia) ? "fds:fim de semana" : "fds:dia util");
    }
  if (d?.eixo === "parte_do_mes") for (const f of d.fatias.filter(nonEmpty)) tags.add(`parte:${fold(f.fatia)}`);
  if (d?.eixo === "hora_do_dia") for (const f of d.fatias.filter(nonEmpty)) tags.add(`hora:${fold(f.fatia)}`);
  if (d?.eixo === "dias_apos_salario" || out.ciclo_salario) tags.add("salario");
  for (const r of out.recorrencias ?? []) {
    tags.add("recorrencia");
    for (const w of r.dias_da_semana) tags.add(`dia:${fold(w)}`);
  }
  for (const p of out.picos?.picos ?? []) tags.add(`dia:${fold(p.dia_da_semana)}`);
  if (out.serie_mensal || out.comparar_periodos || out.forma_pagamento || out.parcelas) tags.add("tendencia");
  if (out.sequencia) tags.add("sequencia");
  return [...tags];
}

export async function investigateTool(deps: ToolDeps, call: Call): Promise<unknown> {
  const { data, ctx, label, escopo, account } = await resolveScope(deps, call);
  const items = ctx.items;
  // Comportamento (calendário, picos, ciclo) olha só o avulso: conta fixa e parcela têm data marcada.
  const avulso = ctx.avulso;
  const out: Record<string, unknown> = {
    periodo: { de: ctx.from, ate: ctx.to },
    escopo,
    cobertura: coverage(ctx, items),
    unidades: "cents com sufixo _cents; por_mes e media_* = por mês; total_* sem sufixo de mês = período inteiro; parte e indice são frações",
  };
  for (const op of call.operacoes) {
    if (op === "serie_mensal") out.serie_mensal = monthlySeries(ctx, items);
    else if (op === "comparar_periodos") out.comparar_periodos = comparePeriods(ctx, items);
    else if (op === "distribuicao") out.distribuicao = distribution(ctx, avulso, call.eixo!);
    else if (op === "ciclo_salario") {
      const months = (await deps.everyday()).months.filter((m) => data.months.includes(m.month));
      out.ciclo_salario = salaryCycles(ctx, items, months.map((m) => ({ mes: m.month, sobra_cents: Number(m.in - m.out) })));
    } else if (op === "forma_pagamento") out.forma_pagamento = paymentMix(ctx, items);
    else if (op === "fragmentacao") out.fragmentacao = fragmentation(ctx, items);
    else if (op === "recorrencias") out.recorrencias = recurrences(ctx, items, data.recipients);
    else if (op === "picos") out.picos = peaks(ctx, avulso, label);
    else if (op === "transacoes") out.transacoes = transactions(items, label, Math.min(call.limite ?? DEFAULT_LIMIT, INVESTIGATE.maxLinhas));
    else if (op === "sequencia") {
      const ref = call.depois_categoria!;
      const target = deps.catalog.categories[Number(ref.slice(1))]?.name;
      if (!target) throw new UserError("Não identifiquei a categoria. Diga o nome exato.");
      const after = investigationContext({
        purchases: data.purchases.filter((p) => p.category === target),
        accountsTime: data.extras.accountsTime,
        salaryDates: data.extras.salaryDates,
        months: data.months,
      });
      const min = call.valor_minimo_cents === undefined ? null : Number(call.valor_minimo_cents);
      const seq = sequence(ctx, items, after.items, { days: call.dias ?? DEFAULT_SEQUENCE_DAYS, minCents: min, category: target }, label);
      out.sequencia = seq;
      // Poucos gatilhos não sustentam conclusão, mesmo que o escopo tenha compras e meses de sobra.
      if (seq.gatilho.compras < SEQUENCE_MIN_TRIGGERS) out.cobertura = { ...coverage(ctx, items), evidencia: "pouca" };
    } else if (op === "parcelas") {
      const { input } = await deps.futurePlan();
      const current = settledToday().slice(0, 7);
      const list = input.cards
        .filter((c) => account === undefined || c.name === account)
        .flatMap((c) => c.installments.map((p) => ({ key: `${c.card}:${p.key}`, cents: p.cents, month: p.month, lastMonth: p.lastMonth ?? p.month })));
      out.parcelas = {
        proximos_meses: futureInstallments(list, current, FUTURE_MONTHS),
        novas_por_mes_fechado: newInstallmentsPerMonth(ctx, items),
        ate: shiftMonth(current, FUTURE_MONTHS - 1),
      };
    }
  }
  // Etiqueta iN da pergunta toda (contagem junto com p0, p1...): frase de dia, hora ou salário cita o resultado.
  const tags = investigationTags(out as InvestigationOut);
  if (tags.length) {
    const ref = `i${[...deps.patternRefs.keys()].filter((k) => k.startsWith("i")).length}`;
    deps.patternRefs.set(ref, { analise: "investigar_gastos", corte: call.operacoes.join(","), recorte: { tipo: "escopo", chave: JSON.stringify(escopo) }, tags });
    out.ref = ref;
  }
  return centsAsText(out);
}
