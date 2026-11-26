// Conclusões sustentadas (SPEC-JUDITE-INVESTIGACAO, parte 2): o papel do
// dinheiro quando dito como economia, o contrato de hipóteses e os critérios de
// encerramento do laço. Regressão da F02a: "economia potencial de R$ 400,00"
// vinha de diferença histórica e de dinheiro que só mudou de forma de pagamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMoney, UNVERIFIED } from "../src/domain/money-check.ts";
import { checkHypotheses } from "../src/domain/hypothesis-check.ts";
import { classifyReply } from "../src/server/judite-protocol.ts";
import { moneySources } from "../src/server/judite-loop.ts";
import { initialPrefetch, openDiagnosticIntent } from "../src/server/judite-evidence.ts";
import { openDatabase } from "../src/server/db.ts";
import { askHelp } from "../src/server/help.ts";
import { COPILOTO_SCENARIOS, OPEN_QUESTION } from "../scripts/judite-eval-copiloto.ts";
import { settledToday } from "../src/server/bank-settled.ts";

const padroes = {
  chamada: { name: "padroes" },
  resultado: {
    destaques: [
      { ref: "p0", em_jogo_formatted: "R$ 400,00", em_jogo_natureza: "diferenca_historica", alavancas: [], base: { corte_formatted: "R$ 2.400,00" }, metades: {} },
      { ref: "p1", em_jogo_formatted: "R$ 400,00", em_jogo_natureza: "movimentado", alavancas: [], base: {}, metades: {} },
      { ref: "p2", em_jogo_formatted: "R$ 139,00", em_jogo_natureza: "alavanca", alavancas: [{ tipo: "corte_no_pico", formatted: "R$ 139,00" }], base: {}, metades: {} },
    ],
  },
};
const sim = (tipo: string) => ({
  chamada: { name: "simular_mudanca" },
  resultado: { ref: "s0", tipo_de_resultado: tipo, custo_mensal_atual_formatted: "R$ 720,00", diferenca_mensal_formatted: "R$ 36,00", diferenca_anual_estimada_formatted: "R$ 432,00" },
});
const sources = (results: unknown[]) => moneySources({ payloadInput: "{}", question: "q", results: results as never });

test("economia: diferença histórica ou dinheiro movimentado não passam como economia; alavanca passa", () => {
  const s = sources([padroes]);
  assert.match(checkMoney("Estimamos uma economia potencial de R$ 400,00 por mês.", s).text, new RegExp(UNVERIFIED.replace(/[[\]]/g, "\\$&")));
  assert.match(checkMoney("Isso devolveria R$ 400,00 por mês.", s).rejected[0]!, /não é economia|diferença histórica/);
  // O mesmo valor dito como o que ele é (diferença) passa.
  assert.equal(checkMoney("O gasto via Pix subiu R$ 400,00 por mês.", s).replaced, 0);
  // Alavanca de rotina é hipotética: passa com a condição, não sem ela.
  assert.equal(checkMoney("Se cortarem o pico, isso devolveria R$ 139,00 por mês.", s).replaced, 0);
  assert.equal(checkMoney("Cortar o pico devolve R$ 139,00 por mês.", s).replaced, 1);
});

test("economia hipotética só com a condição na mesma frase; calculada passa sem condição", () => {
  const h = sources([sim("economia_hipotetica")]);
  assert.equal(checkMoney("Vocês economizariam R$ 36,00 por mês.", h).replaced, 1);
  assert.equal(checkMoney("Se ela aceitar um pacote com 5% de desconto, a economia seria de R$ 36,00 por mês.", h).replaced, 0);
  // Custo atual não é dinheiro de economia, mas também não é bloqueado só por estar na frase.
  assert.equal(checkMoney("Hoje são R$ 720,00; se houver desconto, a economia seria de R$ 36,00.", h).replaced, 0);
  assert.equal(checkMoney("Cancelar economiza R$ 36,00 por mês.", sources([sim("economia_calculada")])).replaced, 0);
});

test("hipóteses: concluir exige investigação; custo exige simulação de economia; refs precisam existir", () => {
  const refs = { patterns: new Set(["p0", "p1", "i0"]), simulations: new Map([["s0", "fluxo_de_caixa"], ["s1", "economia_hipotetica"]]) };
  const base = { evidencias: [], contraevidencias: [] };
  assert.equal(checkHypotheses([{ ...base, hipotese: "Pix aumentou o gasto", status: "nao_sustentada", contraevidencias: ["i0"] }], refs).length, 0);
  assert.match(checkHypotheses([{ ...base, hipotese: "Pix esconde gasto", status: "confirmada", evidencias: ["p1"] }], refs)[0]!, /precisa de investigar_gastos/);
  assert.equal(checkHypotheses([{ ...base, hipotese: "Pix subiu", status: "observacao", evidencias: ["p1"] }], refs).length, 0);
  assert.match(checkHypotheses([{ ...base, hipotese: "x", status: "observacao", evidencias: ["p9"] }], refs)[0]!, /não veio/);
  assert.match(checkHypotheses([{ ...base, hipotese: "pacote", status: "confirmada", evidencias: ["i0"], beneficio: "custo", simulacao: "s0" }], refs)[0]!, /simulação de economia/);
  assert.equal(checkHypotheses([{ ...base, hipotese: "pacote", status: "confirmada", evidencias: ["i0", "s1"], beneficio: "custo", simulacao: "s1" }], refs).length, 0);
  assert.equal(checkHypotheses([{ ...base, hipotese: "um lugar só", status: "confirmada", evidencias: ["i0"], beneficio: "visibilidade" }], refs).length, 0);
});

test("protocolo: hipoteses é interno e opcional; inválido não derruba a resposta", () => {
  const ok = classifyReply(JSON.stringify({ text: "x", action: null, hipoteses: [{ hipotese: "h", status: "observacao", evidencias: ["p0"] }] }));
  assert.equal(ok.kind, "final");
  assert.equal(ok.kind === "final" && ok.hipoteses?.[0]?.status, "observacao");
  const bad = classifyReply(JSON.stringify({ text: "x", action: null, hipoteses: [{ hipotese: "h", status: "talvez" }] }));
  assert.ok(bad.kind === "final" && bad.hipotesesErro && !bad.hipoteses);
  // null nos opcionais (a convenção do prompt) vale como ausente.
  const nulls = classifyReply(JSON.stringify({ text: "x", action: null, hipoteses: [{ hipotese: "h", status: "observacao", evidencias: ["p0"], contraevidencias: null, simulacao: null, mudanca: null, beneficio: null }] }));
  assert.ok(nulls.kind === "final" && nulls.hipoteses?.[0]?.simulacao === undefined && !nulls.hipotesesErro);
  const plain = classifyReply(JSON.stringify({ text: "x", action: null }));
  assert.ok(plain.kind === "final" && plain.hipoteses === undefined);
});

test("intenção de diagnóstico aberto: prefetch de padroes só nela; pergunta factual não muda", () => {
  assert.ok(openDiagnosticIntent(OPEN_QUESTION));
  assert.ok(openDiagnosticIntent("Onde a gente está errando com o dinheiro?"));
  for (const q of ["Quanto gastamos com delivery?", "O que falta pagar?", "Tem algum padrão no delivery?", "Quanto sobra por mês?"]) {
    assert.ok(!openDiagnosticIntent(q), q);
    assert.deepEqual(initialPrefetch({ question: q, activeMemories: 0 }), [], q);
  }
  assert.deepEqual(initialPrefetch({ question: OPEN_QUESTION, activeMemories: 0 }), [{ name: "padroes" }, { name: "renda_por_tipo" }, { name: "avisos_de_dados" }, { name: "proximas_decisoes" }]);
});

// Laço de ponta a ponta com provedor falso sobre a família F02.
function fakeProvider(replies: unknown[]) {
  const seen: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
    seen.push(JSON.parse(body.messages.find((m) => m.role === "user")!.content));
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  }) as typeof fetch;
  return seen;
}

test("laço F02a: lê os sinais, devolve o anúncio, confere as hipóteses e tira a economia falsa", async () => {
  const db = await openDatabase();
  const user = await COPILOTO_SCENARIOS.find((s) => s.id === "F02")!.build(db, 0);
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AI_PROVIDER: "groq", GROQ_API_KEY: "synthetic-key", GROQ_ZDR_CONFIRMED: "true" });
  try {
    const wrong = "Síntese: o Pix subiu. Impacto: estimamos uma economia potencial de R$ 400,00 por mês.";
    const seen = fakeProvider([
      { text: "Vou analisar os padrões de pagamento antes de recomendar.", action: null },
      { text: wrong, action: null, hipoteses: [{ hipotese: "o Pix esconde gastos", status: "confirmada", evidencias: ["p0"] }] },
      { text: wrong, action: null, hipoteses: [{ hipotese: "o Pix aumentou o gasto", status: "evidencia_insuficiente", evidencias: ["p0"] }] },
      { text: "Síntese: a forma de pagamento mudou; não investiguei se o gasto total mudou junto.", action: null, hipoteses: [{ hipotese: "o Pix aumentou o gasto", status: "evidencia_insuficiente", evidencias: ["p0"] }] },
    ]);
    const answer = (await askHelp(db, user, { question: OPEN_QUESTION, month: settledToday().slice(0, 7), currency: "BRL", external: true, chat: true, history: [] })) as {
      text: string;
      trace: Record<string, unknown>;
    };
    const first = seen[0]!.tool_results as { chamada: { name: string } }[];
    assert.ok(first.some((r) => r.chamada.name === "padroes"), "os sinais chegam lidos na 1ª rodada");
    assert.match(String(seen[1]!.aviso), /peça a ferramenta agora/);
    assert.match(String(seen[2]!.aviso), /precisa de investigar_gastos/);
    assert.equal(answer.trace.anuncios, 1);
    assert.doesNotMatch(answer.text, /economia potencial de R\$ 400/);
    assert.ok((answer.trace.hipoteses_problemas as string[]).length > 0);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("etiqueta {{sN}} da simulação: sai do texto e não derruba a frase (regressão qwen4-max)", async () => {
  const { checkPatterns } = await import("../src/domain/pattern-check.ts");
  const refs = new Map([["s0", { analise: "simular_mudanca", corte: "economia_hipotetica", recorte: { tipo: "simulacao", chave: "s0" } }]]);
  const money = checkMoney("Se houver desconto, seriam R$ 36,00 por mês {{s0}}.", sources([sim("economia_hipotetica")]));
  assert.equal(money.replaced, 0);
  const pat = checkPatterns(money.text, refs);
  assert.deepEqual(pat.rejected, []);
  assert.equal(pat.text, "Se houver desconto, seriam R$ 36,00 por mês.");
  // Ref de simulação que não existe continua barrada.
  assert.equal(checkPatterns("Seriam R$ 36,00 {{s7}}.", refs).rejected.length, 1);
});
