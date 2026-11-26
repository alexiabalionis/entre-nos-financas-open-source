// M2 da SPEC-JUDITE-INVESTIGACAO: investigar_gastos sobre as famílias fictícias
// do copiloto. Cada teste confere um número escrito à mão na família.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { toolCall } from "../src/server/judite-tools-schema.ts";
import { COPILOTO_SCENARIOS, F02, F03, F04, F05, catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { ym } from "../scripts/judite-eval-scenarios.ts";

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
const investigate = async (ctx: ToolContext, args: Record<string, unknown>) =>
  (await runTool(ctx, toolCall.parse({ tool: { name: "investigar_gastos", ...args } }).tool)) as Json;

test("F02: o Pix sobe de 30% para 80% e o gasto total por mês fica igual", async () => {
  const ctx = await ctxOf("F02");
  const out = await investigate(ctx, { operacoes: ["forma_pagamento", "serie_mensal"], categoria: cat(ctx, "Alimentação fora") });
  const pix = out.forma_pagamento.partes.find((p: { forma: string }) => p.forma === "pix");
  assert.equal(pix.anterior, F02.pixOld / F02.perMonth);
  assert.equal(pix.recente, F02.pixNew / F02.perMonth);
  assert.equal(out.forma_pagamento.gasto_por_mes.anterior_cents, "80000");
  assert.equal(out.forma_pagamento.gasto_por_mes.recente_formatted, "R$ 800,00");
  assert.equal(out.forma_pagamento.variacao_do_total, 0);
  assert.deepEqual(out.serie_mensal.meses.map((m: { total_cents: number }) => m.total_cents), Array(6).fill("80000"));
  assert.equal(out.cobertura.evidencia, "suficiente");
});

test("F03: a faxina aparece como destinatário opaco, 4 vezes por mês às segundas, sem nome", async () => {
  const ctx = await ctxOf("F03");
  const out = await investigate(ctx, { operacoes: ["recorrencias"], categoria: cat(ctx, "Casa") });
  const [r] = out.recorrencias;
  assert.equal(r.tipo, "destinatario");
  assert.match(r.chave, /^d\d+$/);
  assert.equal(r.valor_tipico_cents, String(F03.value * 100));
  assert.deepEqual(r.vezes_por_mes, [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(r.dias_da_semana, ["segunda"]);
  assert.equal(r.media_ultimos_3_formatted, F03.monthly);
  assert.equal(r.ja_e_conta_fixa, false);
  // O destinatário filtra; nada do nome nem do CPF sai na resposta.
  const rows = await investigate(ctx, { operacoes: ["transacoes"], destinatario: r.chave, limite: 50 });
  assert.equal(rows.transacoes.total_linhas, 24);
  assert.doesNotMatch(JSON.stringify([out, rows]), /\bANA\b|PAULA|LIMPEZA|222\.333/i);
  await assert.rejects(investigate(ctx, { operacoes: ["transacoes"], destinatario: "d99" }), /não apareceu/);
});

test("F04: delivery passa por 3 contas todo mês; 400 por mês", async () => {
  const ctx = await ctxOf("F04");
  const out = await investigate(ctx, { operacoes: ["fragmentacao"], categoria: cat(ctx, "Delivery") });
  const f = out.fragmentacao;
  assert.equal(f.contas_distintas, 3);
  assert.equal(f.meses_com_mais_de_uma_conta, 6);
  assert.equal(f.media_mensal_formatted, F04.monthly);
  assert.deepEqual(f.por_forma.map((x: { chave: string; cents: string }) => [x.chave, x.cents]), [["credito", String(6 * 300 * 100)], ["pix", String(6 * 100 * 100)]]);
});

test("F05: parcelas já assumidas continuam nos próximos meses; uma compra parcelada nova por mês", async () => {
  const ctx = await ctxOf("F05");
  const out = await investigate(ctx, { operacoes: ["parcelas"] });
  assert.deepEqual(out.parcelas.novas_por_mes_fechado.map((m: { novas: number }) => m.novas), [1, 1, 1, 1, 1, 1]);
  const next = out.parcelas.proximos_meses;
  assert.ok(next.length > 0, "a projeção não trouxe parcelas futuras");
  // No mês atual seguem as 6 séries (nenhuma chegou a 10 parcelas).
  assert.equal(next[0].series, 6);
  assert.equal(next[0].parcelas_cents, String(6 * F05.installment * 100));
});

test("F01: o gasto logo depois do salário não deixa mês negativo; combustível é agenda fixa", async () => {
  const ctx = await ctxOf("F01");
  const out = await investigate(ctx, { operacoes: ["ciclo_salario", "distribuicao"], eixo: "dias_apos_salario" });
  assert.equal(out.ciclo_salario.meses_com_sobra_negativa, 0);
  assert.ok(Number(out.ciclo_salario.menor_sobra_cents) > 0);
  assert.ok(out.ciclo_salario.ciclos.length >= 4);
  const fuel = await investigate(ctx, { operacoes: ["distribuicao"], eixo: "parte_do_mes", lugar: "Posto Combustivel" });
  assert.deepEqual(fuel.distribuicao.agenda.dias_do_mes_fixos, ["04", "11", "18", "25"]);
  assert.equal(fuel.distribuicao.agenda.parte_em_dia_fixo, 1);
});

test("padrao: as transações de um destaque são as compras do corte; o escopo inteiro é lido uma vez", async () => {
  const ctx = await ctxOf("F06");
  const patterns = (await runTool(ctx, { name: "padroes" })) as { destaques: { ref: string; analise: string; base: { corte_compras: number } }[] };
  const rec = patterns.destaques.find((d) => d.analise === "recorrencia_escondida")!;
  const out = await investigate(ctx, { operacoes: ["transacoes", "serie_mensal"], padrao: rec.ref });
  assert.equal(out.transacoes.total_linhas, rec.base.corte_compras);
  assert.equal(out.serie_mensal.meses.length, 6);
  assert.equal(ctx.cache.spend?.size, 1);
  await assert.rejects(investigate(ctx, { operacoes: ["transacoes"], padrao: "p99" }), /não veio de padroes/);
});

test("F10: categoria com 2 meses de histórico vem marcada como pouca evidência", async () => {
  const ctx = await ctxOf("F10");
  const out = await investigate(ctx, { operacoes: ["serie_mensal"], categoria: cat(ctx, "Pet") });
  assert.equal(out.cobertura.meses_com_gasto, 2);
  assert.equal(out.cobertura.evidencia, "pouca");
  assert.equal(out.serie_mensal.meses.at(-1).mes, ym(1));
});

test("schema: distribuicao exige eixo; no máximo 3 operações; nada de campo livre", () => {
  assert.throws(() => toolCall.parse({ tool: { name: "investigar_gastos", operacoes: ["distribuicao"] } }));
  assert.throws(() => toolCall.parse({ tool: { name: "investigar_gastos", operacoes: ["serie_mensal", "picos", "transacoes", "recorrencias"] } }));
  assert.throws(() => toolCall.parse({ tool: { name: "investigar_gastos", operacoes: ["serie_mensal"], sql: "select 1" } }));
});

test("etiqueta iN: frase de dia da semana só passa citando a investigação que mostra aquele dia", async () => {
  const { checkPatterns } = await import("../src/domain/pattern-check.ts");
  const ctx = await ctxOf("F03");
  const out = await investigate(ctx, { operacoes: ["recorrencias"], categoria: cat(ctx, "Casa"), meses: 4 });
  assert.match(out.ref, /^i\d+$/);
  const refs = ctx.cache.patternRefs!;
  assert.deepEqual(checkPatterns(`A faxina é paga toda segunda {{${out.ref}}}.`, refs).rejected, []);
  assert.equal(checkPatterns(`A faxina é paga toda sexta {{${out.ref}}}.`, refs).rejected.length, 1);
  // Sem etiqueta, mas a investigação da pergunta mostra a segunda: passa (não se perde a frase).
  const untagged = checkPatterns("A faxina é paga toda segunda.", refs);
  assert.deepEqual(untagged.rejected, []);
  assert.equal(untagged.untagged.length, 1);
});

test("F04: sequencia devolve ref iN, cobertura pouca com menos de 5 gatilhos e recusa categoria desconhecida", async () => {
  const ctx = await ctxOf("F04");
  const out = await investigate(ctx, { operacoes: ["sequencia"], depois_categoria: cat(ctx, "Delivery"), valor_minimo_cents: "99999999" });
  assert.match(out.ref, /^i\d+$/);
  assert.equal(ctx.cache.patternRefs!.get(out.ref)!.tags?.includes("sequencia"), true);
  assert.equal(out.sequencia.gatilho.compras, 0);
  assert.equal(out.cobertura.evidencia, "pouca");
  await assert.rejects(investigate(ctx, { operacoes: ["sequencia"], depois_categoria: "c99" }), /Não identifiquei a categoria/);
});

test("F02: forma de pagamento e conta não têm alavanca; em_jogo diz o que é", async () => {
  const ctx = await ctxOf("F02");
  const out = (await runTool(ctx, { name: "padroes" })) as { destaques: Json[] };
  for (const d of out.destaques) {
    if (["pagamento", "conta"].includes(d.recorte.tipo)) assert.deepEqual(d.alavancas, [], `${d.analise} ${d.recorte.chave}`);
    if (d.analise === "forma_pagamento") assert.equal(d.em_jogo_natureza, "movimentado");
    if (d.analise === "tendencia") assert.equal(d.em_jogo_natureza, "diferenca_historica");
    if (d.em_jogo_natureza === "alavanca") assert.ok(d.alavancas.some((l: Json) => l.cents === d.em_jogo_cents));
  }
  // O R$ 400 que a F02a apresentou como economia não é mais alavanca de nenhum destaque.
  assert.ok(!out.destaques.some((d) => d.alavancas.some((l: Json) => l.formatted === "R$ 400,00")));
});
