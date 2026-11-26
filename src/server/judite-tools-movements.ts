// Ferramentas sobre os lançamentos: as mesmas linhas e a mesma regra de
// filtro e totais da tela Movimentos. O nome vai por promptLabel (sem nome de
// pessoa em Pix e transferência, sem números longos).
import { shiftMonth } from "../domain/card-cycle.ts";
import { addDays } from "../domain/day.ts";
import {
  movementRows,
  movementTotals,
  promptLabel,
  visibleMovements,
  type Movement,
} from "../domain/movements.ts";
import { settledToday } from "./bank-settled.ts";
import { UserError } from "./imports.ts";
import { readCategorySpend } from "./insights.ts";
import { MAX_ROWS, type ToolCall, type ToolDeps } from "./judite-tools-schema.ts";

const MAX_MONTHS = 12;
const MOVEMENTS_COMPETENCE =
  "Lançamentos como na tela Movimentos, pela data do lançamento: compra de cartão aprovada pela data da compra; compra de cartão que ainda vem só do banco aparece na lista e não entra nos totais; lançamento do banco que ainda não virou lançamento aparece como a conferir e não entra nos totais; conta fixa e parcela contam normalmente.";
type Call<N extends ToolCall["name"]> = Extract<ToolCall, { name: N }>;

export function period(call: { de?: string; ate?: string }) {
  const month = settledToday().slice(0, 7);
  const de = call.de ?? `${month}-01`;
  const ate = call.ate ?? addDays(`${shiftMonth(month, 1)}-01`, -1);
  if (de > ate) throw new UserError("O começo do período precisa vir antes do fim.");
  const months: string[] = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = shiftMonth(m, 1)) months.push(m);
  if (months.length > MAX_MONTHS) throw new UserError("Escolha um período de até 12 meses.");
  return { de, ate, months };
}

/** Linhas da tela Movimentos de cada mês do período, só dentro das datas. */
async function rowsIn(deps: ToolDeps, p: { de: string; ate: string; months: string[] }) {
  const rows: Movement[] = [];
  for (const m of p.months) rows.push(...movementRows(await deps.monthState(m)));
  return rows.filter((r) => r.date >= p.de && r.date <= p.ate);
}

/**
 * As compras do período (gasto, sem os itens em revisão): a leitura única de
 * detalhar_categoria e de padroes, para os totais baterem. Sem categoria, todas.
 */
export async function readExpensePurchases(
  deps: ToolDeps,
  p: { de: string; ate: string; months: string[] },
  category?: string,
): Promise<Movement[]> {
  return visibleMovements(await rowsIn(deps, p), { query: "", filter: "expense", category }).filter((r) => !r.review);
}

const wire = (r: Movement) => ({
  data: r.date,
  nome: promptLabel(r),
  conta: r.account,
  categoria: r.category,
  etiqueta: r.tag ?? null,
  valor_cents: r.amount,
  ...(r.fixed ? { fixa: true } : {}),
  ...(r.scheduled ? { agendada: true } : {}),
  ...(r.review ? { a_conferir: true } : {}),
});

export async function searchMovementsTool(deps: ToolDeps, call: Call<"buscar_movimentos">): Promise<unknown> {
  const pick = <T>(list: T[] | undefined, ref: string | undefined, what: string) => {
    if (ref === undefined) return undefined;
    const found = list?.[Number(ref.slice(1))];
    if (!found) throw new UserError(`Não identifiquei ${what}. Diga o nome exato.`);
    return found;
  };
  const category = pick(deps.catalog.categories, call.categoria, "a categoria")?.name;
  const account = pick(deps.catalog.accounts, call.conta, "a conta")?.name;
  const p = period(call);
  const matched = visibleMovements(await rowsIn(deps, p), {
    query: call.texto ?? "",
    filter: call.tipo ?? "all",
    account,
    category,
    tag: call.etiqueta,
  });
  const limit = call.limite ?? 50;
  const totals = movementTotals(matched);
  const perMonth = p.months.map((mes) => {
    const rows = matched.filter((r) => r.date.slice(0, 7) === mes);
    const t = movementTotals(rows);
    return { mes, entrada_cents: t.income, saida_cents: t.expense, linhas: rows.length };
  });
  const applied = {
    ...(call.texto ? { texto: call.texto } : {}),
    ...(category ? { categoria: category } : {}),
    ...(account ? { conta: account } : {}),
    ...(call.etiqueta ? { etiqueta: call.etiqueta } : {}),
    ...(call.tipo ? { tipo: call.tipo } : {}),
  };
  return {
    de: p.de,
    ate: p.ate,
    filtros: applied,
    populacao: "movimentos",
    competencia: MOVEMENTS_COMPETENCE,
    ...(p.months.length > 1 ? { por_mes: perMonth } : {}),
    total_linhas: matched.length,
    cortado: matched.length > limit,
    totais: { entrada_cents: totals.income, saida_cents: totals.expense, a_conferir: totals.review },
    linhas: matched.slice(0, limit).map(wire),
  };
}

export async function topSpendTool(deps: ToolDeps, call: Call<"maiores_gastos">): Promise<unknown> {
  const p = period(call);
  const spend = visibleMovements(await rowsIn(deps, p), { query: "", filter: "expense" }).filter(
    (r) => !r.review && BigInt(r.amount) < 0n,
  );
  const n = call.n ?? 10;
  const abs = (v: string) => -BigInt(v);
  const desc = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);
  if (call.agrupar === "nome") {
    const by = new Map<string, { total: bigint; vezes: number }>();
    for (const r of spend) {
      const k = promptLabel(r);
      const e = by.get(k) ?? { total: 0n, vezes: 0 };
      e.total += abs(r.amount);
      e.vezes++;
      by.set(k, e);
    }
    return {
      de: p.de,
      ate: p.ate,
      nomes: [...by.entries()]
        .sort((a, b) => desc(a[1].total, b[1].total))
        .slice(0, n)
        .map(([nome, e]) => ({ nome, total_cents: e.total.toString(), vezes: e.vezes })),
    };
  }
  return {
    de: p.de,
    ate: p.ate,
    linhas: [...spend]
      .sort((a, b) => desc(abs(a.amount), abs(b.amount)))
      .slice(0, Math.min(n, MAX_ROWS))
      .map(wire),
  };
}

export async function categoryDetailTool(deps: ToolDeps, call: Call<"detalhar_categoria">): Promise<unknown> {
  const category = deps.catalog.categories[Number(call.categoria.slice(1))]?.name;
  if (!category) throw new UserError("Não identifiquei a categoria. Diga o nome exato.");
  const p = period(call);
  const spend = await readExpensePurchases(deps, p, category);
  const by = new Map<string, { total: bigint; vezes: number; itens: Map<string, { total: bigint; vezes: number }> }>();
  for (const r of spend) {
    const tag = r.tag ?? "Sem etiqueta";
    const e = by.get(tag) ?? { total: 0n, vezes: 0, itens: new Map() };
    const cents = -BigInt(r.amount);
    e.total += cents;
    e.vezes++;
    const name = promptLabel(r);
    const i = e.itens.get(name) ?? { total: 0n, vezes: 0 };
    i.total += cents;
    i.vezes++;
    e.itens.set(name, i);
    by.set(tag, e);
  }
  const desc = <T extends { total: bigint }>(a: [string, T], b: [string, T]) =>
    a[1].total < b[1].total ? 1 : a[1].total > b[1].total ? -1 : a[0].localeCompare(b[0]);
  const total = [...by.values()].reduce((s, e) => s + e.total, 0n);
  return {
    categoria: category,
    de: p.de,
    ate: p.ate,
    total_cents: total.toString(),
    etiquetas: [...by.entries()].sort(desc).map(([etiqueta, e]) => ({
      etiqueta,
      total_cents: e.total.toString(),
      vezes: e.vezes,
      itens: [...e.itens.entries()]
        .sort(desc)
        .slice(0, 20)
        .map(([nome, i]) => ({ nome, total_cents: i.total.toString(), vezes: i.vezes })),
    })),
  };
}

export async function compareMonthsTool(deps: ToolDeps, call: Call<"comparar_meses">): Promise<unknown> {
  const [a, b] = await Promise.all([
    readCategorySpend(deps.db, deps.user, call.mes_a),
    readCategorySpend(deps.db, deps.user, call.mes_b),
  ]);
  const names = new Set([...a.categories, ...b.categories].map((c) => c.name));
  const of = (s: typeof a, name: string) => s.categories.find((c) => c.name === name)?.cents ?? 0n;
  const rows = [...names].map((name) => {
    const va = of(a, name);
    const vb = of(b, name);
    return { name, va, vb, diff: vb - va };
  });
  const size = (v: bigint) => (v < 0n ? -v : v);
  // Sinal em palavra e valor sem sinal: o modelo escreve "caiu R$ 1.000,00",
  // e o número precisa estar no resultado do jeito que ele vai citar.
  const change = (diff: bigint) => ({
    mudou: diff > 0n ? "subiu" : diff < 0n ? "caiu" : "igual",
    quanto_cents: size(diff).toString(),
  });
  rows.sort((x, y) => (size(x.diff) < size(y.diff) ? 1 : size(x.diff) > size(y.diff) ? -1 : x.name.localeCompare(y.name)));
  return {
    mes_a: call.mes_a,
    mes_b: call.mes_b,
    total_a_cents: a.total_cents.toString(),
    total_b_cents: b.total_cents.toString(),
    total: change(b.total_cents - a.total_cents),
    categorias: rows.map((r) => ({
      categoria: r.name,
      mes_a_cents: r.va.toString(),
      mes_b_cents: r.vb.toString(),
      ...change(r.diff),
    })),
  };
}
