// M3 da SPEC-JUDITE-INVESTIGACAO: simular_mudanca sobre as famílias fictícias.
// Rótulos e base decididos em 22/11/2026: custo = média dos 3 últimos meses
// fechados; desconto, teto e frequência são hipotéticos; cancelar é calculado;
// mudar datas compara o caixa de forma relativa. Nada pode ser gravado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { toolCall } from "../src/server/judite-tools-schema.ts";
import { costChange, type Baseline } from "../src/domain/change-simulate.ts";
import { applyScenario, projectFuture } from "../src/domain/future-months.ts";
import { readFuture } from "../src/server/future-plan.ts";
import { COPILOTO_SCENARIOS, F03, catalogFor } from "../scripts/judite-eval-copiloto.ts";

// Resultado de ferramenta é JSON livre: os testes leem campos conhecidos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const db = await openDatabase();
const contexts = new Map<string, ToolContext>();
async function ctxOf(id: string): Promise<ToolContext> {
  const found = contexts.get(id);
  if (found) return found;
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === id)!.build(db, 0);
  const ctx: ToolContext = { db, user, catalog: await catalogFor(db, user), currency: "BRL", cache: {} };
  contexts.set(id, ctx);
  return ctx;
}
const cat = (ctx: ToolContext, name: string) => `c${ctx.catalog.categories.findIndex((c) => c.name === name)}`;
const simulate = async (ctx: ToolContext, args: Record<string, unknown>) =>
  (await runTool(ctx, toolCall.parse({ tool: { name: "simular_mudanca", ...args } }).tool)) as Json;

const TABLES = ["economic_events", "ledger_entries", "monthly_items", "recurrences", "recurrence_occurrences", "goals", "bank_transactions", "audit_events"];
async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!.n;
  return out;
}

test("F03: pacote com 5% de desconto sobre 4 x R$ 180 = R$ 36 por mês, R$ 432 no ano, hipotético", async () => {
  const ctx = await ctxOf("F03");
  const out = await simulate(ctx, { mudanca: { tipo: "desconto", pct: 5 }, categoria: cat(ctx, "Casa") });
  assert.equal(out.custo_mensal_atual_formatted, F03.monthly);
  assert.equal(out.diferenca_mensal_formatted, "R$ 36,00");
  assert.equal(out.diferenca_anual_estimada_formatted, "R$ 432,00");
  assert.equal(out.tipo_de_resultado, "economia_hipotetica");
  assert.match(out.condicao, /confirmar/);
  assert.match(out.aviso, /nada foi salvo/);
});

test("F03: pagar tudo no dia 5 não muda o custo; o caixa vem comparado de forma relativa", async () => {
  const ctx = await ctxOf("F03");
  const before = await counts();
  const out = await simulate(ctx, { mudanca: { tipo: "concentrar_pagamentos", dia: 5 }, categoria: cat(ctx, "Casa") });
  assert.equal(out.tipo_de_resultado, "fluxo_de_caixa");
  assert.equal(out.diferenca_mensal_cents, "0");
  assert.equal(out.caixa.relativo, true);
  assert.equal(out.caixa.sem_dia_a_dia, true);
  assert.equal(out.caixa.padrao_atual.dias.length, 4);
  assert.equal(out.caixa.meses.length, 3);
  // O total do mês é o mesmo nas duas versões: no fim do mês o saldo não muda; o menor saldo pode mudar.
  for (const m of out.caixa.meses) assert.ok(Number(m.diferenca_cents) <= 0, `${m.mes}: pagar tudo de uma vez não pode subir o menor saldo`);
  assert.deepEqual(await counts(), before);
});

test("F06: cancelar o curso é economia calculada pelo valor que se repete", async () => {
  const ctx = await ctxOf("F06");
  const out = await simulate(ctx, { mudanca: { tipo: "cancelar" }, lugar: "Curso Ingles Online" });
  assert.equal(out.tipo_de_resultado, "economia_calculada");
  assert.equal(out.diferenca_mensal_formatted, "R$ 129,90");
  await assert.rejects(simulate(ctx, { mudanca: { tipo: "cancelar" }, categoria: cat(ctx, "Mercado") }), /se repete/);
});

test("F09: teto e uma compra a menos são hipotéticos e dependem de manter o hábito", async () => {
  const ctx = await ctxOf("F09");
  const teto = await simulate(ctx, { mudanca: { tipo: "teto", teto_cents: "20000" }, categoria: cat(ctx, "Café e padaria") });
  assert.equal(teto.tipo_de_resultado, "economia_hipotetica");
  assert.match(teto.condicao, /manter/);
  assert.equal(teto.custo_mensal_novo_cents, "20000");
  const freq = await simulate(ctx, { mudanca: { tipo: "reduzir_frequencia", vezes_a_menos_por_mes: 4 }, categoria: cat(ctx, "Café e padaria") });
  assert.equal(Number(freq.diferenca_mensal_cents), Math.round(4 * Number(freq.base.ticket_medio_cents)));
});

test("conta fixa: aluguel com outro vencimento muda só o caixa; com outro valor, economia calculada", async () => {
  const ctx = await ctxOf("F08");
  const day = await simulate(ctx, { mudanca: { tipo: "conta_fixa", conta_fixa: "aluguel", novo_dia: 20 } });
  assert.equal(day.tipo_de_resultado, "fluxo_de_caixa");
  assert.equal(day.diferenca_mensal_cents, "0");
  const value = await simulate(ctx, { mudanca: { tipo: "conta_fixa", conta_fixa: "Aluguel", novo_valor_cents: "170000" } });
  assert.equal(value.tipo_de_resultado, "economia_calculada");
  assert.equal(value.diferenca_mensal_formatted, "R$ 100,00");
  await assert.rejects(simulate(ctx, { mudanca: { tipo: "conta_fixa", conta_fixa: "Academia", novo_dia: 3 } }), /Não achei/);
});

test("F05: compra de R$ 1.200 em 6x no crédito ocupa as faturas dos próximos meses", async () => {
  const ctx = await ctxOf("F05");
  const out = await simulate(ctx, { mudanca: { tipo: "compra", valor_cents: "120000", parcelas: 6, forma: "credito" } });
  assert.equal(out.tipo_de_resultado, "comprometimento_futuro");
  const added = out.por_mes.map((m: Record<string, string>) => Number(m.faturas_depois_cents) - Number(m.faturas_antes_cents));
  assert.equal(added.reduce((a: number, b: number) => a + b, 0), 120000);
  assert.ok(added.filter((x: number) => x > 0).length === 6);
});

test("engine: conta fixa e imprevisto datado entram nas datas pedidas; sem cenário a projeção é a mesma", async () => {
  const ctx = await ctxOf("F08");
  const { input, result } = await readFuture(db, ctx.user, {});
  assert.deepEqual(projectFuture(applyScenario(input, {})).rows.map((r) => r.cash.low), result.rows.map((r) => r.cash.low));
  const month = input.fixed.find((m) => m.items.some((l) => l.label === "Aluguel") && m.month > input.startMonth)!.month;
  const edited = applyScenario(input, { fixedEdits: [{ label: "Aluguel", fromMonth: month, day: 27 }] });
  assert.equal(edited.fixed.find((m) => m.month === month)!.items.find((l) => l.label === "Aluguel")!.date, `${month}-27`);
  const shocked = projectFuture(applyScenario(input, { shocks: [{ kind: "despesa", month, months: 1, cents: 50000n, label: "Teste", day: 15 }] }));
  assert.equal(shocked.rows.find((r) => r.month === month)!.cash.events.find((e) => e.label === "Teste")!.date, `${month}-15`);
});

test("rótulos puros: sem desconto, concentrar não promete economia; desconto nunca vira calculado", () => {
  const base: Baseline = { meses: ["2026-08", "2026-09", "2026-10"], custo_mensal_cents: 72000, compras_por_mes: 4, ticket_medio_cents: 18000, ultimo_mes: null };
  assert.equal(costChange(base, { tipo: "concentrar_pagamentos", dia: 5 }).diferenca_mensal_cents, 0);
  const withDiscount = costChange(base, { tipo: "concentrar_pagamentos", dia: 5, descontoPct: 5 });
  assert.equal(withDiscount.tipo_de_resultado, "economia_hipotetica");
  assert.equal(withDiscount.diferenca_anual_estimada_cents, 43200);
  assert.equal(costChange(base, { tipo: "desconto", pct: 10 }).tipo_de_resultado, "economia_hipotetica");
});
