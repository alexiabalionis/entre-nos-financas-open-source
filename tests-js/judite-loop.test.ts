// Fase 7.5: protocolo, remoção de afirmações sem origem, contratos de
// evidência e chave canônica. Sem modelo real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReply } from "../src/server/judite-protocol.ts";
import { dropUnverified, UNVERIFIED } from "../src/domain/money-check.ts";
import { evidenceOf, followUp, initialPrefetch, recallIntent } from "../src/server/judite-evidence.ts";
import { toolKey, type ToolContext } from "../src/server/judite-tools.ts";

test("classifyReply: quatro tipos", () => {
  assert.equal(classifyReply('{"tool":{"name":"notas"}}').kind, "tool_call");
  assert.equal(classifyReply('{"text":"x","action":{"tool":{"name":"notas"}}}').kind, "tool_call", "aninhado em action");
  assert.equal(classifyReply('{"text":"Olá","action":null}').kind, "final");
  assert.equal(classifyReply('{"text":"Olá","action":null,"tool":null}').kind, "final");
  const bad = classifyReply('{"tool":{"name":"buscar_movimentos","limite":500}}');
  assert.equal(bad.kind, "invalid_tool");
  assert.match(bad.kind === "invalid_tool" ? bad.error : "", /limite/);
  assert.equal(classifyReply("oi").kind, "invalid_reply");
  assert.equal(classifyReply('{"action":null}').kind, "invalid_reply");
  assert.equal(classifyReply("[1,2]").kind, "invalid_reply");
});

test("dropUnverified: sai a afirmação, o item, a lista vazia com a introdução, e a conclusão dependente", () => {
  const u = UNVERIFIED;
  assert.equal(dropUnverified(`Delivery custou R$ 1.200,00 em agosto. Lazer custou ${u}. Ou seja, vocês recuperam muito. Pet ficou igual.`).text,
    "Delivery custou R$ 1.200,00 em agosto. Pet ficou igual.");
  assert.equal(
    dropUnverified(`Gastos:\n- Lazer: R$ 300,00\n- Delivery: ${u}\n\nResumo final.`).text,
    "Gastos:\n- Lazer: R$ 300,00\n\nResumo final.",
  );
  assert.equal(dropUnverified(`Diferenças:\n- A: ${u}\n- B: ${u}\n\nPet ficou igual.`).text, "Pet ficou igual.");
  assert.equal(dropUnverified(`Só ${u}.`).text, "");
  assert.doesNotMatch(dropUnverified(`Texto ${u} sem ponto`).text, /valor não conferido/);
});

test("prefetch de memória: só com pedido inequívoco de algo decidido antes", () => {
  const yes = ["Estamos cumprindo o que combinamos sobre o delivery?", "Qual era o nosso objetivo de sobra?", "Qual o limite de Lazer que a gente combinou?", "O que decidimos sobre Pet?"];
  const no = ["Onde dá para cortar?", "Como estamos?", "Quanto gastamos com delivery?", "Dá para guardar R$ 500 para uma viagem?", "Qual é a meta de sobra boa para nós?"];
  for (const q of yes) assert.ok(recallIntent(q), q);
  for (const q of no) assert.ok(!recallIntent(q), q);
  assert.deepEqual(initialPrefetch({ question: yes[0], activeMemories: 0 }), [], "sem memória ativa, não busca");
  assert.equal(initialPrefetch({ question: yes[0], activeMemories: 3 })[0].name, "search_memory");
});

test("evidência com escopo: 'cumprindo o combinado' exige o gasto da categoria do combinado", () => {
  const categories = [{ name: "Pet" }, { name: "Delivery" }];
  const memory = {
    chamada: { name: "search_memory" },
    resultado: { memorias: [{ ref: "m0", tipo: "combinado", categoria: null, temas: ["delivery"], texto: "Delivery até R$ 600,00." }] },
  };
  const q = "Estamos cumprindo o que combinamos sobre o delivery?";
  assert.deepEqual(followUp({ question: q, results: [memory], categories }), {
    name: "historico_categoria",
    categoria: "c1",
    comparar_com: "m0",
  });
  // O gasto de OUTRA categoria não satisfaz.
  const pet = { chamada: { name: "historico_categoria" }, resultado: { categoria: "Pet", meses: [{ mes: "2026-10" }] } };
  assert.ok(followUp({ question: q, results: [memory, pet], categories }));
  // Uma fonte equivalente da mesma categoria satisfaz.
  const detail = { chamada: { name: "detalhar_categoria" }, resultado: { categoria: "Delivery", de: "2026-10-01", ate: "2026-10-31" } };
  assert.equal(followUp({ question: q, results: [memory, detail], categories }), null);
  // buscar_movimentos só vale para a categoria se todas as linhas forem dela
  // (ou se o filtro de categoria foi aplicado); misturado, é evidência geral.
  const mixed = { chamada: { name: "buscar_movimentos" }, resultado: { de: "2026-10-01", ate: "2026-10-31", linhas: [{ categoria: "Delivery" }, { categoria: "Pet" }] } };
  assert.deepEqual(evidenceOf(mixed).map((e) => e.kind), ["movimentos"]);
  const filtered = { ...mixed, resultado: { ...mixed.resultado, filtros: { categoria: "Delivery" } } };
  assert.equal(followUp({ question: q, results: [memory, filtered], categories }), null);
  // Pergunta aberta: nenhuma exigência.
  assert.equal(followUp({ question: "Como estamos?", results: [memory], categories }), null);
  // Resultado com erro não é evidência.
  assert.deepEqual(evidenceOf({ chamada: { name: "historico_categoria" }, resultado: { erro: "x" } }), []);
});

test("toolKey: mesma coisa pedida de dois jeitos dá a mesma chave; escopo diferente, chave diferente", () => {
  const ctx = (familyId: string): ToolContext =>
    ({
      db: null,
      user: { userId: "u", familyId, name: "", email: "", role: "owner" },
      catalog: { categories: [{ id: "cat-a", name: "Pet" }, { id: "cat-b", name: "Delivery" }], accounts: [] },
      currency: "BRL",
      cache: {},
    }) as unknown as ToolContext;
  const a = ctx("f1");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const month = today.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  assert.equal(
    toolKey(a, { name: "buscar_movimentos", texto: "  IFOOD " }),
    toolKey(a, { name: "buscar_movimentos", texto: "ifood", de: `${month}-01`, ate: last, limite: 50 }),
  );
  assert.equal(
    toolKey(a, { name: "search_memory", temas: ["Ração", "pet"] }),
    toolKey(a, { name: "search_memory", temas: ["pet", "racao"], limite: 10 }),
  );
  assert.notEqual(toolKey(a, { name: "historico_categoria", categoria: "c0" }), toolKey(a, { name: "historico_categoria", categoria: "c1" }));
  assert.notEqual(toolKey(a, { name: "notas" }), toolKey(ctx("f2"), { name: "notas" }), "outra casa");
});
