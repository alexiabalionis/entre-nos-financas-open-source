// Contexto de finalização: o que ele diz que é permitido é exatamente o que os validadores aceitam.
import assert from "node:assert/strict";
import test from "node:test";
import { checkHypotheses, hypothesisAllowances, type Hypothesis, type RefIndex } from "../src/domain/hypothesis-check.ts";
import { checkMoney, savingUse, wrongRole, type MoneyRole } from "../src/domain/money-check.ts";
import { finalizationContext } from "../src/server/judite-finalize.ts";
import { moneyRoles, type ToolResult } from "../src/server/judite-loop.ts";

const refs: RefIndex = {
  patterns: new Set(["p0", "p1", "i0"]),
  simulations: new Map([
    ["s0", "economia_hipotetica"],
    ["s1", "fluxo_de_caixa"],
  ]),
};
const h = (x: Partial<Hypothesis>): Hypothesis => ({ hipotese: "x", status: "observacao", evidencias: ["p0"], contraevidencias: [], ...x });

test("hipóteses: o que o contexto lista como permitido passa em checkHypotheses; o resto não", () => {
  const a = hypothesisAllowances(refs);
  assert.deepEqual(a.concluir_com, ["i0", "s0", "s1"]);
  assert.deepEqual(a.custo_com_simulacao, ["s0"]);
  for (const r of a.concluir_com) assert.deepEqual(checkHypotheses([h({ status: "nao_sustentada", contraevidencias: [r] })], refs), [], r);
  assert.equal(checkHypotheses([h({ status: "confirmada", evidencias: ["p0", "p1"] })], refs).length, 1, "só pN não conclui");
  for (const s of a.custo_com_simulacao) assert.deepEqual(checkHypotheses([h({ beneficio: "custo", simulacao: s })], refs), []);
  assert.equal(checkHypotheses([h({ beneficio: "custo", simulacao: "s1" })], refs).length, 1, "fluxo de caixa não é custo");
  assert.equal(checkHypotheses([h({ status: "nao_sustentada", contraevidencias: ["i0"], beneficio: "custo" })], refs).length, 1);
  // Sem benefício monetário a hipótese passa: derrubada sem beneficio, organização com outro benefício.
  assert.deepEqual(checkHypotheses([h({ status: "nao_sustentada", contraevidencias: ["i0"] }), h({ beneficio: "protecao_futura", mudanca: "separar valor" })], refs), []);
  assert.equal(checkHypotheses([h({ evidencias: [] })], refs).length, 1, "observação sem ref");
  for (const b of a.beneficios_validos.filter((x) => x !== "custo")) assert.deepEqual(checkHypotheses([h({ beneficio: b })], refs), [], b);
});

test("savingUse decide igual a wrongRole para todo conjunto de papéis", () => {
  const all: MoneyRole[] = ["economia", "hipotetica", "nao_economia", "outro"];
  const sets = [undefined, ...Array.from({ length: 15 }, (_, k) => new Set(all.filter((_r, i) => (k + 1) & (1 << i))))];
  for (const s of sets) {
    const use = savingUse(s);
    const bare = wrongRole("isso economiza R$ 10,00", s);
    const cond = wrongRole("se mantiverem, economiza R$ 10,00", s);
    if (use === "livre") assert.ok(!bare && !cond);
    if (use === "com_condicao") assert.ok(bare && !cond);
    if (use === "nao_e_economia") assert.ok(bare && cond);
  }
});

test("dinheiro: economia simulada, alavanca condicional, diferença histórica e dinheiro movimentado, com o uso que checkMoney aplica", () => {
  const results: ToolResult[] = [
    {
      chamada: { name: "padroes" },
      resultado: {
        destaques: [
          { ref: "p0", base: {}, metades: {}, alavancas: [{ tipo: "reduzir_frequencia", formatted: "R$ 160,00" }], em_jogo_formatted: "R$ 160,00", em_jogo_natureza: "alavanca" },
          { ref: "p1", base: {}, metades: {}, alavancas: [], em_jogo_formatted: "R$ 400,00", em_jogo_natureza: "diferenca_historica" },
          { ref: "p2", base: {}, metades: {}, alavancas: [], em_jogo_formatted: "R$ 900,00", em_jogo_natureza: "movimentado" },
        ],
      },
    },
    { chamada: { name: "simular_mudanca" } as never, resultado: { ref: "s0", tipo_de_resultado: "economia_calculada", diferenca_mensal_formatted: "R$ 129,00", diferenca_anual_estimada_formatted: "R$ 1.548,00" } },
  ];
  const roles = moneyRoles(results, "");
  const ctx = finalizationContext({ results, refs, roles });
  const by = new Map(ctx.dinheiro_como_economia.valores.map((v) => [v.valor, v]));
  assert.deepEqual([by.get("R$ 160,00")?.natureza, by.get("R$ 160,00")?.uso], ["alavanca_condicional", "com_condicao"]);
  assert.deepEqual([by.get("R$ 400,00")?.natureza, by.get("R$ 400,00")?.uso], ["diferenca_historica", "nao_e_economia"]);
  assert.deepEqual([by.get("R$ 900,00")?.natureza, by.get("R$ 900,00")?.uso], ["dinheiro_movimentado", "nao_e_economia"]);
  assert.deepEqual([by.get("R$ 129,00")?.natureza, by.get("R$ 129,00")?.uso], ["economia_simulada", "livre"]);
  // O uso dito no contexto é o que a conferência faz com a frase.
  const sources = { financial: ctx.dinheiro_como_economia.valores.map((v) => v.valor).join("\n"), roles };
  for (const v of ctx.dinheiro_como_economia.valores) {
    const bare = checkMoney(`Isso economiza ${v.valor} por mês.`, sources).replaced;
    const cond = checkMoney(`Se mantiverem, isso economiza ${v.valor} por mês.`, sources).replaced;
    assert.equal(bare, v.uso === "livre" ? 0 : 1, v.valor);
    assert.equal(cond, v.uso === "nao_e_economia" ? 1 : 0, v.valor);
  }
});
