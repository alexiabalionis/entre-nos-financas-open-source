// Ferramentas da sobra: média dos meses fechados, caminhos até um alvo, o que
// está acima do normal, histórico de uma categoria e as notas da casa.
import { aboveUsual, sobraPaths } from "../domain/sobra-paths.ts";
import { typicalMonth } from "../domain/income-types.ts";
import { listContext } from "./context-notes.ts";
import { moneyCents } from "../domain/money-check.ts";
import { UserError } from "./imports.ts";
import type { ToolCall, ToolDeps } from "./judite-tools-schema.ts";

const str = (v: bigint) => v.toString();

const EVERYDAY_COMPETENCE =
  "Gasto de dia a dia da categoria, pela data do lançamento: compras no cartão pela data da compra e saídas do banco ainda pendentes entram; conta fixa conciliada e parcela de cartão ficam de fora.";

type Sobra = Extract<ToolCall, { name: "sobra_atual" | "caminhos_para_sobrar" | "acima_do_normal" }>;

export async function sobraTool(deps: ToolDeps, call: Sobra): Promise<unknown> {
  const e = await deps.everyday();
  const input = {
    months: e.months,
    categories: e.categories,
    protectedNames: new Set(e.protectedNames),
    currentMonth: e.currentMonth,
  };
  const closed = e.months.filter((m) => m.month < e.currentMonth && (m.in > 0n || m.out > 0n));
  if (call.name === "acima_do_normal") {
    const r = aboveUsual(input);
    if (!r) return { sem_historico: true, motivo: "Ainda não há mês fechado com movimento." };
    const excess = r.above.reduce((s, a) => s + a.excess, 0n);
    const back = r.kept + excess;
    return {
      meses_fechados: r.months,
      entrada_media_cents: str(r.avgIn),
      saida_media_cents: str(r.avgOut),
      sobra_media_cents: str(r.kept),
      sobra_pct: r.pct,
      // Se todas as não protegidas voltarem ao normal (o modelo não soma).
      excesso_total_cents: str(excess),
      sobra_se_voltar_ao_normal_cents: str(back),
      sobra_se_voltar_ao_normal_pct: r.avgIn > 0n ? Number((back * 1000n) / r.avgIn) / 10 : null,
      acima: r.above.map((a) => ({
        categoria: a.name,
        normal_cents: str(a.usual),
        ultimos_3_meses_cents: str(a.recent),
        excesso_cents: str(a.excess),
      })),
      protegidas_acima: r.protectedAbove.map((p) => ({
        categoria: p.name,
        normal_cents: str(p.usual),
        ultimos_3_meses_cents: str(p.recent),
      })),
    };
  }
  const target =
    call.name === "caminhos_para_sobrar"
      ? call.alvo_pct !== undefined
        ? { pct: call.alvo_pct }
        : { cents: BigInt(call.alvo_cents!) }
      : { cents: 0n };
  const r = sobraPaths({ ...input, target });
  if (!r) return { sem_historico: true, motivo: "Ainda não há mês fechado com movimento." };
  const base = {
    meses_fechados: r.months,
    entrada_media_cents: str(r.avgIn),
    saida_media_cents: str(r.avgOut),
    sobra_media_cents: str(r.kept),
    sobra_pct: r.pct,
  };
  if (call.name === "sobra_atual") {
    const typical = typicalMonth(closed);
    return {
      ...base,
      meses: closed.map((m) => ({
        mes: m.month,
        entrou_cents: str(m.in),
        saiu_cents: str(m.out),
        sobra_cents: str(m.in - m.out),
      })),
      ...(typical
        ? {
            mes_tipico: {
              explicacao: "Mediana dos meses fechados: um mês fora da curva não arrasta o número. A média (acima) é a conta real do período, com esses meses.",
              entrada_mediana_cents: str(typical.entradaMediana),
              saida_mediana_cents: str(typical.saidaMediana),
              sobra_mediana_cents: str(typical.sobraMediana),
              meses_fora_da_curva: typical.foraDaCurva.map((m) => ({ mes: m.month, saiu_cents: str(m.out) })),
            },
          }
        : {}),
    };
  }
  return {
    ...base,
    alvo_sobra_cents: str(r.target.kept),
    alvo_pct: r.target.pct,
    diferenca_cents: str(r.gap),
    passos: r.steps.map((s) => ({
      categoria: s.name,
      normal_cents: str(s.usual),
      ultimos_3_meses_cents: str(s.recent),
      corte_cents: str(s.cut),
      sobra_depois_cents: str(s.kept),
      pct_depois: s.pct,
    })),
    falta_cents: str(r.missing),
    protegidas_acima: r.protectedAbove.map((p) => ({
      categoria: p.name,
      normal_cents: str(p.usual),
      ultimos_3_meses_cents: str(p.recent),
    })),
  };
}

export async function categoryHistoryTool(deps: ToolDeps, ref: string, compareWith?: string): Promise<unknown> {
  const name = deps.catalog.categories[Number(ref.slice(1))]?.name;
  if (!name) throw new UserError("Não identifiquei a categoria. Diga o nome exato.");
  // Limite vindo de uma memória lida nesta pergunta (nunca de um número do modelo).
  let limit: bigint | null = null;
  if (compareWith !== undefined) {
    const m = deps.memoryRefs.get(compareWith);
    const first = m && [...m.values][0];
    if (!first) throw new UserError("Não achei um valor nessa memória. Busque a memória de novo.");
    limit = moneyCents(first);
  }
  const [e, ctx] = await Promise.all([deps.everyday(), listContext(deps.db, deps.user)]);
  const closed = e.months.filter((m) => m.month < e.currentMonth && (m.in > 0n || m.out > 0n)).map((m) => m.month);
  const byMonth = new Map(e.categories.filter((c) => c.name === name).map((c) => [c.month, c.cents]));
  const series = closed.map((m) => byMonth.get(m) ?? 0n);
  const avg = (xs: bigint[]) => (xs.length ? xs.reduce((s, x) => s + x, 0n) / BigInt(xs.length) : 0n);
  const row = ctx.categories.find((c) => c.name === name);
  const versus = (v: bigint) =>
    limit === null
      ? {}
      : v > limit
        ? { em_relacao_ao_combinado: "acima", diferenca_cents: str(v - limit) }
        : { em_relacao_ao_combinado: v < limit ? "abaixo" : "igual", diferenca_cents: str(limit - v) };
  return {
    categoria: name,
    periodo: closed.length ? { de: closed[0], ate: closed[closed.length - 1], meses: closed.length } : null,
    populacao: "dia_a_dia",
    competencia: EVERYDAY_COMPETENCE,
    total_cents: str(series.reduce((s, x) => s + x, 0n)),
    meses: closed.map((m, i) => ({ mes: m, cents: str(series[i]), ...versus(series[i]) })),
    ...(compareWith !== undefined ? { comparado_com: compareWith } : {}),
    normal_cents: str(avg(series)),
    ultimos_3_meses_cents: str(avg(series.slice(-3))),
    protegida: e.protectedNames.includes(name),
    nota: row?.note ?? null,
    justificativas: ctx.monthNotes.filter((n) => n.name === name).map((n) => ({ mes: n.month, nota: n.note })),
  };
}

export async function notesTool(deps: ToolDeps): Promise<unknown> {
  const ctx = await listContext(deps.db, deps.user);
  return {
    casa: ctx.household,
    categorias: ctx.categories,
    justificativas: ctx.monthNotes.map((n) => ({ categoria: n.name, mes: n.month, nota: n.note })),
  };
}
