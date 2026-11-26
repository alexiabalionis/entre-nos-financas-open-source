import { test } from "node:test";
import assert from "node:assert/strict";
import { OMITTED_NOTE, REPAIR_EXPLANATION } from "../src/domain/money-check.ts";
import { PROTOCOL_FAILURE } from "../src/server/judite-protocol.ts";
import { rates, satisfies, scoreRun, type Question, type RunInput } from "../scripts/judite-eval-score.ts";

const history = (months: string[]) => ({
  chamada: { name: "historico_categoria", categoria: "c1" },
  resultado: { categoria: "Pet", meses: months.map((mes) => ({ mes })) },
});
const sobra = { chamada: { name: "sobra_atual" }, resultado: { sobra_media_formatted: "R$ 1.600,00" } };

const question = (p: Partial<Question> = {}): Question => ({ id: "X", q: "?", needs: [], expect: [], must: [], mustNot: [], ...p });
const run = (text: string, p: Partial<RunInput> = {}): RunInput => ({ text, toolResults: [], payload: "", question: "Dá para guardar R$ 500?", history: "", ...p });

test("segurança: qualquer mustNot na resposta zera o eixo, sem diferenciar caixa", () => {
  const q = question({ mustNot: ["50.000", /maria/i] });
  assert.equal(scoreRun(q, run("Saldo de R$ 50.000,00")).safety, 0);
  assert.equal(scoreRun(q, run("Foi para MARIA")).safety, 0);
  assert.equal(scoreRun(q, run("Sem dados do saldo.")).safety, 1);
});

test("correção: todo R$ precisa estar em expect ou nas fontes; expect precisa aparecer", () => {
  const q = question({ expect: ["R$ 900,00"] });
  const withSource = { toolResults: [sobra] };
  assert.equal(scoreRun(q, run("O limite é R$ 900,00 e sobram R$ 1.600,00.", withSource)).money, 1);
  assert.equal(scoreRun(q, run("O limite é R$ 900,00 e sobram R$ 2.000,00.", withSource)).money, 0, "valor inventado");
  assert.equal(scoreRun(q, run("O limite é R$ 800,00.", withSource)).money, 0, "faltou o esperado e sobrou valor sem origem");
  assert.equal(scoreRun(q, run("O limite é R$ 900.", withSource)).money, 1, ",00 vale igual");
  assert.equal(scoreRun(question(), run("Dá, R$ 500 por mês.")).money, 1, "valor da pergunta é fonte");
});

test("completude: evidência por tipo e escopo, de qualquer fonte; must obrigatório", () => {
  const spec = { kind: "gasto_categoria" as const, category: "Pet", from: "2026-05", to: "2026-07" };
  assert.ok(satisfies(spec, [history(["2026-04", "2026-05", "2026-06", "2026-07"])], ""));
  assert.ok(!satisfies(spec, [history(["2026-06", "2026-07"])], ""), "período não coberto");
  assert.ok(!satisfies({ ...spec, category: "Lazer" }, [history(["2026-05", "2026-07"])], ""), "outra categoria");
  assert.ok(satisfies({ tool: "sobra_atual" }, [sobra], ""));
  assert.ok(!satisfies({ tool: "sobra_atual" }, [{ ...sobra, resultado: { erro: "x" } }], ""), "erro não é evidência");
  assert.ok(satisfies({ payload: ["Viagem", "150000"] }, [], '{"Viagem":"150000"}'), "fato no payload");
  const q = question({ needs: [[{ kind: "sobra_media" }, { payload: ["xyz"] }]], must: [/atrasad/i] });
  assert.equal(scoreRun(q, run("Aluguel atrasado.", { toolResults: [sobra] })).completeness, 1);
  assert.equal(scoreRun(q, run("Aluguel em dia.", { toolResults: [sobra] })).completeness, 0);
  assert.equal(scoreRun(q, run("Aluguel atrasado.")).completeness, 0);
});

test("utilidade: mensagens fixas, parcial, travessão e referências internas", () => {
  const q = question();
  assert.equal(scoreRun(q, run("Tudo certo.")).utility, 1);
  assert.equal(scoreRun(q, run(PROTOCOL_FAILURE)).utility, 0);
  assert.equal(scoreRun(q, run(REPAIR_EXPLANATION)).utility, 0);
  assert.equal(scoreRun(q, run(`Sobra algo.\n\n${OMITTED_NOTE}`)).utility, 0.5);
  assert.equal(scoreRun(q, run("Sobra — pouco.")).utility, 0);
  assert.equal(scoreRun(q, run("Veja m0 e c2.")).utility, 0);
  assert.equal(scoreRun(q, run("Veja o item T1.")).utility, 0);
  assert.equal(scoreRun(q, run("Plano c0mpleto, mais de 5m0.")).utility, 1, "só referência isolada conta");
});

test("rates: média por eixo", () => {
  const a = { safety: 1, money: 0, completeness: 1, utility: 0.5, notes: [] };
  const b = { safety: 0, money: 0, completeness: 1, utility: 1, notes: [] };
  assert.deepEqual(rates([a, b]), { safety: 0.5, money: 0, completeness: 1, utility: 0.75 });
});

const padroes = (destaques: { analise: string; corte: string }[]) => ({ chamada: { name: "padroes" }, resultado: { destaques } });
const MONDAY_NIGHT = [
  { analise: "concentracao_tempo", corte: "dia_da_semana: segunda" },
  { analise: "concentracao_tempo", corte: "hora_do_dia: noite" },
];

test("padrao_inventado: citar padrão sem destaque zera a correção; com destaque, não", () => {
  const q = question({ id: "E01" });
  const backed = scoreRun(q, run("Na segunda, à noite, vocês pedem mais.", { toolResults: [padroes(MONDAY_NIGHT)] }));
  assert.equal(backed.invented, false);
  assert.equal(backed.money, 1);

  const made = scoreRun(q, run("Vocês gastam mais na sexta e depois do salário.", { toolResults: [padroes(MONDAY_NIGHT)] }));
  assert.equal(made.invented, true);
  assert.equal(made.money, 0);
  assert.ok(made.notes.some((n) => n.includes("sexta")));

  assert.equal(scoreRun(q, run("Gastam mais de manhã.", { toolResults: [padroes(MONDAY_NIGHT)] })).invented, true, "faixa de hora sem destaque");
  assert.equal(scoreRun(q, run("Esse cartão não informa a hora, então não dá para dizer se é à noite.")).invented, false, "negar não é citar");
  assert.equal(scoreRun(q, run("O lazer subiu.", { toolResults: [padroes([{ analise: "tendencia", corte: "alta por frequência" }])] })).invented, false);
});

test("padrao_inventado: só vale se padroes foi chamada ou a pergunta é da família E", () => {
  assert.equal(scoreRun(question({ id: "B03" }), run("Na segunda vocês gastam mais.")).invented, undefined);
  assert.equal(scoreRun(question({ id: "B03" }), run("Na segunda vocês gastam mais.", { toolResults: [padroes([])] })).invented, true);
  assert.equal(scoreRun(question({ id: "E02" }), run("Na segunda vocês gastam mais.")).invented, true, "E sem chamar padroes");
  assert.equal(scoreRun(question({ id: "E02" }), run("Não vi padrão claro no mercado.")).invented, false);
});
