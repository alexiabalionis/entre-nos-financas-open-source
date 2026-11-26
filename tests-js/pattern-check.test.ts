import assert from "node:assert/strict";
import test from "node:test";
import { checkMoney, UNVERIFIED, type Period } from "../src/domain/money-check.ts";
import { checkPatterns, claimTags, type PatternRef } from "../src/domain/pattern-check.ts";

const refs = new Map<string, PatternRef>([
  ["p0", { analise: "concentracao_tempo", corte: "dia_da_semana_e_hora: segunda noite", recorte: { tipo: "lugar", chave: "Ifood" } }],
  ["p1", { analise: "recorrencia_escondida", corte: "todo mês", recorte: { tipo: "lugar", chave: "Streaming" } }],
  ["p2", { analise: "concentracao_tempo", corte: "semana_do_mes: 2ª", recorte: { tipo: "casa", chave: "casa" } }],
  ["p3", { analise: "concentracao_tempo", corte: "hora_do_dia: tarde da noite", recorte: { tipo: "lugar", chave: "Ifood" } }],
]);

test("etiqueta certa passa e some do texto", () => {
  const r = checkPatterns("Vocês pedem delivery nas segundas à noite {{p0}}. Vale tentar cozinhar.", refs);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.text, "Vocês pedem delivery nas segundas à noite. Vale tentar cozinhar.");
});

test("etiqueta que não diz aquilo pede reescrita, mas a frase fica (22/11/2026: padrão não apaga resposta)", () => {
  const r = checkPatterns("O mercado é mais de manhã {{p0}}.", refs);
  assert.equal(r.rejected.length, 1);
  assert.ok(!r.text.includes(UNVERIFIED));
  assert.equal(r.text, "O mercado é mais de manhã.");
});

test("etiqueta que não existe é bloqueada", () => {
  assert.equal(checkPatterns("Vocês pedem na segunda à noite {{p9}}.", refs).rejected.length, 1);
});

test("dia da semana ou horário sem etiqueta: sem base pede reescrita; sustentado por um destaque da pergunta passa", () => {
  assert.equal(checkPatterns("Vocês gastam mais na sexta.", refs).rejected.length, 1);
  const night = checkPatterns("A maior parte sai à noite.", refs);
  assert.deepEqual(night.rejected, []);
  assert.equal(night.untagged.length, 1);
});

test("os falsos positivos do eval antigo passam", () => {
  const ok = [
    "Olha, para saber se vocês gastam mais à noite no cartão, eu precisaria ver a hora exata.",
    "Como não tenho as horas, não consigo afirmar se é de manhã, tarde ou noite.",
    "Isso gera um pedido recorrente.",
    "O gasto com Lazer subiu de agosto em diante.",
    "A fatura vence na segunda-feira.",
    "Se conseguirem pular a entrega de segunda, devolve um pouco.",
  ];
  for (const s of ok) assert.deepEqual(checkPatterns(s, refs).rejected, [], s);
});

test("segunda semana é a semana do mês, não segunda-feira", () => {
  assert.deepEqual([...claimTags("as compras se concentram na segunda semana do mês")], ["semana:2"]);
  assert.deepEqual(checkPatterns("As compras se concentram na segunda semana do mês {{p2}}.", refs).rejected, []);
});

test("tarde da noite não é confundida com tarde", () => {
  assert.deepEqual([...claimTags("pedem tarde da noite")], ["hora:tarde da noite"]);
  assert.deepEqual(checkPatterns("Vocês pedem tarde da noite {{p3}}.", refs).rejected, []);
});

test("recorrência e tendência só são conferidas com etiqueta; outro destaque da pergunta que diga aquilo sustenta", () => {
  assert.deepEqual(checkPatterns("A assinatura aparece todo mês {{p1}}.", refs).rejected, []);
  assert.deepEqual(checkPatterns("A assinatura aparece todo mês {{p0}}.", refs).rejected, []);
  const only = new Map([["p0", refs.get("p0")!]]);
  assert.equal(checkPatterns("A assinatura aparece todo mês {{p0}}.", only).rejected.length, 1);
});

const periods = (entries: [string, Period[]][]) => new Map(entries.map(([v, p]) => [v, new Set(p)]));

test("total do período dito como por mês é bloqueado", () => {
  const sources = { financial: "R$ 2.100,00\nR$ 350,00", periods: periods([["R$2.100", ["periodo"]], ["R$350", ["mes"]]]) };
  assert.equal(checkMoney("Eletronicos Shop: R$ 2.100,00 por mês.", sources).replaced, 1);
  assert.equal(checkMoney("Eletronicos Shop soma R$ 2.100,00 em 6 meses, R$ 350,00 por mês.", sources).replaced, 0);
  assert.equal(checkMoney("Cancelar devolve R$ 350,00 no total.", sources).replaced, 1);
});

test("valor que também aparece sem rótulo não tem o período conferido", () => {
  const sources = { financial: "R$ 2.100,00", periods: periods([["R$2.100", ["periodo", "neutro"]]]) };
  assert.equal(checkMoney("R$ 2.100,00 por mês.", sources).replaced, 0);
});

test("checkMoney deixa a etiqueta de padrão para checkPatterns", () => {
  const r = checkMoney("Vocês pedem na segunda à noite {{p0}}, R$ 350,00 por mês.", { financial: "R$ 350,00" });
  assert.equal(r.replaced, 0);
  assert.deepEqual(checkPatterns(r.text, refs).rejected, []);
});

test("'segunda' como ordinal ao lado de 'primeira' não é dia da semana (regressão qwen4-max)", async () => {
  const { claimTags } = await import("../src/domain/pattern-check.ts");
  assert.ok(!claimTags("Gasto total: R$ 4.690,00 na primeira metade e R$ 4.690,00 na segunda, sem diferença.").has("dia:segunda"));
  assert.ok(claimTags("Na primeira semana e na segunda-feira seguinte.").has("dia:segunda"));
  assert.ok(claimTags("Vocês pedem delivery na segunda à noite.").has("dia:segunda"));
});

test("negação por oração: o que foi procurado e não achado não é afirmado; o resto da frase continua conferido", () => {
  // As três frases da rodada roteada de 22/11/2026 (citavam um resultado sem recorrência).
  const noRec = new Map<string, PatternRef>([["i0", { analise: "investigar_gastos", corte: "recorrencias", recorte: { tipo: "escopo", chave: "{}" }, tags: ["tendencia"] }]]);
  for (const s of [
    "O que percebi: procurei assinaturas recorrentes e não encontrei nenhum lançamento na categoria Assinaturas nos seis meses {{i0}}.",
    "Duas coisas que verifiquei e não sustentam recomendação: não há nenhuma assinatura registrada nesses meses, então não há o que cancelar por aqui {{i0}}.",
    '"Há assinaturas esquecidas comendo a sobra" não se confirmou, a categoria Assinaturas não teve nenhuma compra registrada nesses seis meses {{i0}}.',
  ])
    assert.deepEqual(checkPatterns(s, noRec).rejected, [], s);
  // Continua sem base: afirmação positiva, ou a parte afirmada depois de uma negação.
  assert.equal(checkPatterns("A assinatura aparece todo mês {{i0}}.", noRec).rejected.length, 1);
  assert.equal(checkPatterns("Não há outra cobrança, mas a assinatura aparece todo mês {{i0}}.", noRec).rejected.length, 1);
  assert.equal(checkPatterns("Não encontrei nada no início, mas vocês pedem delivery na sexta {{p0}}.", refs).rejected.length, 1);
  // Busca com achado positivo, ou "verifiquei que", continua afirmando o que diz.
  assert.equal(checkPatterns("Procurei assinaturas e encontrei uma que aparece todo mês {{i0}}.", noRec).rejected.length, 1);
  assert.equal(checkPatterns("Verifiquei que a assinatura aparece todo mês {{i0}}.", noRec).rejected.length, 1);
  assert.equal(checkPatterns("Procurei de novo e vocês pedem na sexta, não na segunda {{p0}}.", refs).rejected.length, 1);
});

test("oração condicional de hipótese não afirma padrão; 'se' reflexivo continua afirmando (rodada A5, 22/11/2026)", () => {
  const sim = new Map<string, PatternRef>([["s0", { analise: "simular_mudanca", corte: "economia_hipotetica", recorte: { tipo: "simulacao", chave: "s0" } }]]);
  for (const s of [
    "É economia hipotética: só vale se vocês mantiverem essas 4 compras a menos todo mês {{s0}}.",
    "Impacto: R$ 150,00 por mês, hipotético — só se acontecer de manter uma compra a menos todo mês {{s0}}.",
  ])
    assert.deepEqual(checkPatterns(s, sim).rejected, [], s);
  assert.equal(checkPatterns("O gasto se concentra na segunda {{s0}}.", sim).rejected.length, 1);
  assert.equal(checkPatterns("Se vocês mantiverem, a assinatura aparece todo mês {{s0}}.", sim).rejected.length, 1);
  assert.equal(checkPatterns("A assinatura aparece todo mês {{s0}}.", sim).rejected.length, 1);
});
