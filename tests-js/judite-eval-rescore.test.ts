import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRescore, rescore } from "../scripts/judite-eval-rescore.ts";
import { rates } from "../scripts/judite-eval-score.ts";

const record = (over: Record<string, unknown>) => ({
  model: "modelo-x",
  family: "A",
  rep: 1,
  questionId: "A05",
  q: "A gente tem um carro novo e Transporte vai subir. Guarda isso para lembrar depois.",
  history: [],
  text: "Combinado, vou lembrar disso.",
  toolResults: [],
  payload: "",
  trace: { tokens: 150, tokens_entrada: 100, tokens_saida: 50, tokens_do_cache: 10, idas_ao_modelo: 2, ms_no_modelo: 400, executadas: 1, solicitadas: 1, repetidas: 0, invalidas: 0, reparos: 0, removidos: 0 },
  ms: 1000,
  error: "",
  ...over,
});
const lines = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const meta = { meta: { data: "2026-11-20T130000", modelos: ["modelo-x"], familias: ["A"], reps: 1 } };

test("repontua duas respostas: nota por eixo e taxas esperadas", () => {
  const content = lines([meta, record({}), record({ rep: 2, text: "Combinado — vou lembrar disso." })]);
  const { results, warnings } = rescore(content);
  assert.equal(results.length, 2);
  assert.deepEqual(warnings, []);
  assert.equal(results[0].scores.utility, 1);
  assert.equal(results[1].scores.utility, 0, "travessão zera utilidade");
  const rate = rates(results.map((r) => r.scores));
  assert.deepEqual([rate.safety, rate.money, rate.completeness, rate.utility], [1, 1, 1, 0.5]);
  const md = renderRescore(content, { priceIn: 1, priceOut: 2 });
  assert.match(md, /50%/);
  assert.match(md, /US\$ 0\.0004/, "(200 x 1 + 100 x 2) / 1e6");
});

test("linha truncada no fim é tolerada e avisada", () => {
  const full = lines([meta, record({})]);
  const { results, warnings } = rescore(`${full}\n{"model":"modelo-x","family":"A","rep":2,"questionId":"A0`);
  assert.equal(results.length, 1);
  assert.equal(warnings.length, 1);
});

test("pergunta removida dos cenários avisa e pula", () => {
  const { results, warnings } = rescore(lines([meta, record({ questionId: "Z99" }), record({})]));
  assert.equal(results.length, 1);
  assert.match(warnings[0], /Z99/);
});
