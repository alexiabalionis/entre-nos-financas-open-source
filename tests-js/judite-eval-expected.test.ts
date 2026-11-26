import { test, before } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/domain/day.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { openDatabase, type Database } from "../src/server/db.ts";
import type { Identity } from "../src/server/auth.ts";
import { readCategorySpend } from "../src/server/insights.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { readState } from "../src/server/state.ts";
import { B_EMPTY_BACK, E, SCENARIOS, ym } from "../scripts/judite-eval-scenarios.ts";

// Cada esperado das perguntas do eval foi escrito à mão (com a conta ao lado
// em scripts/judite-eval-scenarios.ts). Aqui o código de produção precisa
// chegar nos mesmos números; se divergir, investigue antes de mexer no esperado.

let db: Database;
const users: Record<string, Identity> = {};

before(async () => {
  db = await openDatabase();
  for (const s of SCENARIOS) users[s.id] = await s.build(db, 0);
});

const lastDay = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

async function context(id: string): Promise<{ ctx: ToolContext; ref: (name: string) => string }> {
  const user = users[id];
  const state = await readState(db, user, `${ym(0)}-01`, "BRL", undefined, undefined, false);
  const catalog = { accounts: state.accounts, categories: state.categories, goals: [] };
  const ctx: ToolContext = { db, user, catalog, currency: "BRL", cache: {} };
  const ref = (name: string) => `c${state.categories.findIndex((c) => c.name === name)}`;
  return { ctx, ref };
}

const run = async (id: string, call: Record<string, unknown>) => {
  const { ctx } = await context(id);
  return (await runTool(ctx, call as never)) as Record<string, unknown>;
};
const spend = async (id: string, month: string) => {
  const s = await readCategorySpend(db, users[id], month);
  return { total: s.total_cents, by: Object.fromEntries(s.categories.map((c) => [c.name, c.cents])) };
};

test("sobra média: A 908,34 (908,333 truncado pela saída média), B 1.600,00, C 2.300,00", async () => {
  assert.equal((await run("A", { name: "sobra_atual" })).sobra_media_formatted, "R$ 908,34");
  const b = await run("B", { name: "sobra_atual" });
  assert.equal(b.entrada_media_formatted, "R$ 9.250,00");
  assert.equal(b.saida_media_formatted, "R$ 7.650,00");
  assert.equal(b.sobra_media_formatted, "R$ 1.600,00");
  assert.equal((b.meses as unknown[]).length, 6, "o mês sem dados fica de fora");
  assert.equal((await run("C", { name: "sobra_atual" })).sobra_media_formatted, "R$ 2.300,00");
});

test("B: gasto por mês, categoria e mês vazio", async () => {
  assert.equal((await spend("B", ym(1))).total, 743000n);
  assert.equal((await spend("B", ym(2))).by.Pet, 95000n);
  const pet = await run("B", { name: "historico_categoria", categoria: (await context("B")).ref("Pet") });
  assert.equal(pet.normal_cents, "65000");
  const delivery = (await Promise.all([1, 2, 3].map((b) => spend("B", ym(b))))).reduce((s, m) => s + m.by.Delivery, 0n);
  assert.equal(delivery, 141000n);
  const empty = await spend("B", ym(B_EMPTY_BACK));
  assert.equal(empty.total, 0n);
  assert.deepEqual(empty.by, {});
});

test("B: Pet por etiqueta no mês retrasado", async () => {
  const { ref } = await context("B");
  const r = (await run("B", { name: "detalhar_categoria", categoria: ref("Pet"), de: `${ym(2)}-01`, ate: lastDay(ym(2)) })) as {
    total_cents: string;
    etiquetas: { etiqueta: string; total_cents: string }[];
  };
  assert.equal(r.total_cents, "95000");
  assert.deepEqual(Object.fromEntries(r.etiquetas.map((e) => [e.etiqueta, e.total_cents])), { Veterinário: "65000", Ração: "30000" });
});

test("B: maiores gastos do mês passado e Pix sem nome nem CPF", async () => {
  const r = await run("B", { name: "maiores_gastos", de: `${ym(1)}-01`, ate: lastDay(ym(1)), n: 10 });
  const lines = r.linhas as { nome: string; valor_cents: string }[];
  assert.deepEqual(lines.slice(0, 2).map((l) => l.valor_cents), ["-300000", "-210000"]);
  assert.equal(lines.find((l) => l.valor_cents === "-21000")?.nome, "Pix enviado");
  assert.doesNotMatch(JSON.stringify(r), /maria|silva|123\.456|12345678909/i);
});

test("B: contas fixas e cartões do mês", async () => {
  const fixed = (await run("B", { name: "contas_fixas" })) as { contas: { nome: string; valor_cents: string; situacao: string }[] };
  const bill = (n: string) => fixed.contas.find((c) => c.nome === n)!;
  assert.deepEqual([bill("Aluguel").valor_cents, bill("Aluguel").situacao], ["180000", "atrasada"]);
  assert.equal(bill("Internet").valor_cents, "12000");
  assert.equal(bill("Escola").valor_cents, "95000");
  const cards = (await run("B", { name: "cartoes" })) as { cartoes: { cartao: string; faturas: { vencimento_mes: string; total_cents: string }[] }[] };
  const due = (name: string) => cards.cartoes.find((c) => c.cartao === name)!.faturas.find((f) => f.vencimento_mes === ym(0))?.total_cents;
  assert.equal(due("Cartão Roxo"), "90000");
  assert.equal(due("Cartão Azul"), "45000");
});

test("B: falta_pagar junta contas, faturas e atrasos sem contar compra do cartão duas vezes", async () => {
  type Item = { nome: string; tipo: string; valor_cents: string; situacao: string };
  const r = (await run("B", { name: "falta_pagar" })) as { itens: Item[]; total_cents: string; atrasadas_cents: string; atrasadas: number };
  const item = (nome: string) => r.itens.filter((i) => i.nome === nome);
  assert.deepEqual(item("Aluguel").map((i) => [i.valor_cents, i.situacao]), [["180000", "atrasada"]]);
  assert.equal(item("Internet")[0]?.valor_cents, "12000");
  assert.equal(item("Escola")[0]?.valor_cents, "95000");
  // A compra parcelada e a da loja estão DENTRO da fatura: nenhuma aparece de novo.
  assert.deepEqual(item("Fatura Cartão Roxo").map((i) => [i.tipo, i.valor_cents]), [["fatura de cartão", "90000"]]);
  assert.equal(item("Fatura Cartão Azul")[0]?.valor_cents, "45000");
  assert.ok(!r.itens.some((i) => /LOJA|ELETRODOMESTICO|FARMACIA/i.test(i.nome)));
  // Os totais prontos batem com os itens.
  const sum = (xs: Item[]) => xs.reduce((s, i) => s + BigInt(i.valor_cents), 0n).toString();
  assert.equal(r.total_cents, sum(r.itens));
  assert.equal(r.atrasadas_cents, sum(r.itens.filter((i) => i.situacao === "atrasada")));
  assert.equal(r.atrasadas, r.itens.filter((i) => i.situacao === "atrasada").length);
});

test("B: reservas com combinado do mês", async () => {
  const r = (await run("B", { name: "reservas" })) as { objetivos: Record<string, string | null>[] };
  const goal = (name: string) => r.objetivos.find((g) => g.nome === name)!;
  assert.deepEqual([goal("Viagem").guardado_cents, goal("Viagem").falta_cents, goal("Viagem").combinado_do_mes_cents], ["150000", "450000", "40000"]);
  assert.deepEqual([goal("Reserva de emergência").guardado_cents, goal("Reserva de emergência").combinado_do_mes_cents], ["400000", null]);
});

test("B: memórias vigente, antiga, substituída e futura", async () => {
  const find = async (consulta: string) => JSON.stringify(await run("B", { name: "search_memory", consulta, limite: 5 }));
  assert.match(await find("delivery"), /R\$ 450,00/);
  const lazer = await find("lazer");
  assert.match(lazer, /R\$ 650,00/);
  assert.doesNotMatch(lazer, /R\$ 700,00/);
  assert.match(await find("pet normal"), /R\$ 250,00/);
  assert.match(await find("sobra objetivo"), /R\$ 2\.000,00/);
});

test("A e C: valores esperados das perguntas de Delivery, Pet e comparação", async () => {
  const a = async (m: number) => (await spend("A", ym(m))).by;
  assert.equal((await a(1)).Delivery, 90000n);
  assert.equal((await a(1)).Pet, 130000n);
  assert.equal((await spend("A", ym(1))).total, 980000n, "2.400 + 1.300 + 900 + 1.200 + 800 + 3.200");
  const total = async (m: number) => (await spend("A", ym(m))).total;
  assert.equal((await total(2)) - (await total(1)), 100000n, "caiu R$ 1.000,00 do retrasado para o passado");
  assert.equal((await spend("C", ym(1))).by.Delivery, 70000n);
});

test("D: delivery pela memória é a categoria Alimentação fora; iFood pelo nome é só o iFood", async () => {
  assert.equal((await spend("D", ym(1))).by["Alimentação fora"], 40000n, "120 + 80 + 200");
  const memory = JSON.stringify(await run("D", { name: "search_memory", consulta: "quanto gastamos com delivery", limite: 5 }));
  assert.match(memory, /Alimentação fora/);
  const ifood = (await run("D", { name: "buscar_movimentos", texto: "ifood", de: `${ym(1)}-01`, ate: lastDay(ym(1)) })) as {
    totais: { saida_cents: string };
  };
  assert.equal(ifood.totais.saida_cents, "12000");
});

// ---------------------------------------------------------------- Família E

type Found = {
  analise: string;
  recorte: { tipo: string; chave: string };
  corte: string;
  base: { corte_compras: number; corte_cents: string };
  metades: Record<string, number | string> | null;
  alavancas: { tipo: string; cents: string; formatted: string }[];
};
type Padroes = { destaques: Found[]; cobertura_hora: number };

async function padroes(category?: string, account?: string): Promise<Padroes> {
  const { ctx, ref } = await context("E");
  const state = await readState(db, users.E, `${ym(0)}-01`, "BRL", undefined, undefined, false);
  const conta = account ? `a${state.accounts.findIndex((a) => a.name === account)}` : undefined;
  const call = { name: "padroes", ...(category ? { categoria: ref(category) } : {}), ...(conta ? { conta } : {}) };
  return (await runTool(ctx, call as never)) as unknown as Padroes;
}
const lever = (h: Found | undefined, kind: string) => h?.alavancas.find((a) => a.tipo === kind)?.formatted;

test("E: delivery tem segunda, segunda à noite e a alavanca de uma a menos por semana", async () => {
  const r = await padroes("Delivery");
  const cuts = r.destaques.map((h) => h.corte);
  assert.ok(cuts.includes("dia_da_semana: segunda"), cuts.join(" | "));
  assert.ok(cuts.includes("dia_da_semana_e_hora: segunda noite"), cuts.join(" | "));
  assert.equal(lever(r.destaques.find((h) => h.corte === "dia_da_semana: segunda"), "uma_a_menos_por_semana"), E.deliveryLever);
});

test("E: assinatura de R$ 21,90 vira recorrência escondida; padaria, compras pequenas", async () => {
  const sub = (await padroes("Assinaturas")).destaques.find((h) => h.analise === "recorrencia_escondida");
  assert.equal(sub?.base.corte_cents, "13140", "6 x 21,90");
  assert.equal(lever(sub, "cancelar_recorrencia"), E.subscriptionLever);
  const small = (await padroes("Padaria")).destaques.find((h) => h.analise === "compras_pequenas");
  assert.equal(small?.base.corte_compras, 168);
  assert.equal(lever(small, "compras_pequenas_pela_metade"), "R$ 212,00");
});

test("E: lazer sobe por frequência (240 para 480) e o mês isolado de Passeios não vira tendência", async () => {
  const up = (await padroes("Lazer")).destaques.find((h) => h.analise === "tendencia");
  assert.equal(up?.corte, "alta por frequência");
  assert.deepEqual(up?.metades, { anterior_cents: String(E.lazerBefore * 100), anterior_formatted: "R$ 240,00", recente_cents: String(E.lazerAfter * 100), recente_formatted: "R$ 480,00" });
  assert.equal((await padroes("Passeios")).destaques.filter((h) => h.analise === "tendencia").length, 0);
});

test("E: gasto avulso concentrado depois do salário gera o ritmo do ciclo", async () => {
  const geral = await padroes();
  assert.ok(geral.destaques.some((h) => h.analise === "ritmo_salario"));
});

test("E: mercado, com horas e dias espalhados, não gera nenhum destaque", async () => {
  assert.deepEqual((await padroes("Mercado")).destaques, []);
});

test("E: cartão sem hora não gera padrão de hora, e o Pix com nome não aparece", async () => {
  const roxo = await padroes(undefined, "Cartão Roxo");
  assert.equal(roxo.cobertura_hora, 0);
  assert.equal(roxo.destaques.filter((h) => /hora/.test(h.corte)).length, 0);
  const all = JSON.stringify([await padroes(), await padroes("Outros"), roxo]);
  assert.doesNotMatch(all, /JO[ÃA]O|PEDRO|SOUZA|111\.222|pix/i);
});
