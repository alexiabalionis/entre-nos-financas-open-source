// Eixo copiloto da avaliação (M4): checagens automáticas puras sobre respostas escritas à mão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copilotoChecks, scoreRun, type Question } from "../scripts/judite-eval-score.ts";
import { COPILOTO_SCENARIOS, OPEN_QUESTION } from "../scripts/judite-eval-copiloto.ts";

const question = (id: string) => COPILOTO_SCENARIOS.flatMap((s) => s.questions).find((q) => q.id === id)!;
const sim = {
  chamada: { name: "simular_mudanca" },
  resultado: { tipo_de_resultado: "economia_hipotetica", diferenca_mensal_formatted: "R$ 36,00", diferenca_anual_estimada_formatted: "R$ 432,00" },
};
const run = (text: string, toolResults: unknown[] = [sim]) => ({ text, toolResults: toolResults as never, payload: "{}", question: OPEN_QUESTION, history: "" });

test("copiloto: economia hipotética precisa da condição na mesma frase", () => {
  const q = question("F03b");
  assert.equal(copilotoChecks(q, run("Vocês economizariam R$ 36,00 por mês."))!.score, 0);
  assert.equal(copilotoChecks(q, run("Se ela der 5% de desconto num pacote, seriam R$ 36,00 por mês."))!.score, 1);
});

test("copiloto: motivo psicológico derruba o eixo", () => {
  const q = question("F02a");
  assert.equal(copilotoChecks(q, run("O Pix pode esconder compras por impulso.", []))!.score, 0);
});

test("copiloto: pergunta aberta longa pede Onde vocês estão e Próximos passos; 'nada a mudar' curto passa", () => {
  const q = question("F08a");
  const long = `${"Vocês gastam menos do que entra e a sobra é estável. ".repeat(10)}`;
  assert.equal(copilotoChecks(q, run(`**Onde vocês estão** ${long}`, []))!.score, 0);
  assert.equal(copilotoChecks(q, run(long, []))!.score, 0);
  assert.equal(copilotoChecks(q, run(`**Onde vocês estão** ${long} **Próximos passos** a, b.`, []))!.score, 1);
  assert.equal(copilotoChecks(q, run("Olhei os seis meses e não encontrei oportunidade que se sustente: os gastos estão estáveis.", []))!.score, 1);
});

test("copiloto: fora das famílias F o eixo não se aplica; referência interna d0 tira utilidade", () => {
  const other: Question = { id: "A01", q: "x", needs: [], expect: [], must: [], mustNot: [] };
  assert.equal(copilotoChecks(other, run("x", [])), undefined);
  assert.equal(scoreRun(question("F03b"), run("A faxina vai para d0 toda segunda.", [])).utility, 0);
});
