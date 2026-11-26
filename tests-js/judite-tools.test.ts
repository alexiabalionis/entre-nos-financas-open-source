import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { askHelp } from "../src/server/help.ts";
import { checkMoney, OMITTED_NOTE } from "../src/domain/money-check.ts";
import { MAX_PROTOCOL_RETRIES, PROTOCOL_FAILURE } from "../src/server/judite-protocol.ts";

test("checkMoney: só passa dinheiro que veio de uma fonte; ,00 vale igual", () => {
  const sources = { financial: '{"sobra_media_formatted":"R$ 969,84","corte_formatted":"R$ 600,00"}' };
  const r = checkMoney("Sobram R$ 969,84; cortando R$ 600 chega lá. Ou R$ 1.234,00.", sources);
  assert.equal(r.text, "Sobram R$ 969,84; cortando R$ 600 chega lá. Ou [valor não conferido].");
  assert.equal(r.replaced, 1);
  assert.equal(checkMoney("Sem valores.", sources).replaced, 0);
});

async function family() {
  const db = await openDatabase();
  const email = "tools@example.invalid";
  const userId = await createFamily(db, {
    name: "Pessoa fictícia",
    familyName: "Teste",
    email,
    password: "SenhaFicticia!2026",
  });
  const familyId = (
    await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])
  ).rows[0].household_id;
  const user: Identity = { userId, familyId, name: "Pessoa", email, role: "owner" };
  return { db, user };
}

/** Provedor falso: devolve as respostas na ordem e guarda o que recebeu. */
function fakeProvider(replies: unknown[]) {
  const seen: { input: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
    seen.push({ input: JSON.parse(body.messages.find((m) => m.role === "user")!.content) });
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  }) as typeof fetch;
  return seen;
}

async function withProvider(run: () => Promise<void>) {
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "synthetic-key";
  process.env.GROQ_ZDR_CONFIRMED = "true";
  try {
    await run();
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
const ask = (question: string) => ({ question, month, currency: "BRL", external: true, chat: true, history: [] });

test("laço: ferramenta pedida é executada e volta em tool_results; dinheiro inventado é trocado", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const seen = fakeProvider([
      { tool: { name: "notas" } },
      { tool: { name: "caminhos_para_sobrar", alvo_pct: 6 } },
      { text: "Sem histórico ainda. Com R$ 50 por mês daria R$ 777,77.", action: null },
    ]);
    // Pergunta da rota de sempre (JSON): "como sobrar mais" agora é diagnóstico (rota aberta, 23/11/2026).
    const answer = await askHelp(db, user, ask("Quanto sobra por mês? Dá para guardar R$ 50?"));
    assert.equal(seen.length, 4, "3 rodadas + 1 reparo");
    assert.deepEqual(seen[0].input.tool_results, []);
    assert.equal(seen[0].input.ferramentas_restantes, 6);
    const results = seen[2].input.tool_results as { chamada: { name: string }; resultado: unknown }[];
    assert.deepEqual(results.map((r) => r.chamada.name), ["notas", "caminhos_para_sobrar"]);
    assert.deepEqual(results[1].resultado, { sem_historico: true, motivo: "Ainda não há mês fechado com movimento." });
    // R$ 50 veio da pergunta; R$ 777,77 ninguém calculou: o reparo pede a
    // reescrita e, como o modelo insiste, a afirmação sai inteira.
    assert.deepEqual((seen[3].input.reparo as { valores_sem_origem: string[] }).valores_sem_origem, ["R$ 777,77"]);
    assert.equal(answer.text, `Sem histórico ainda.\n\n${OMITTED_NOTE}`);
    assert.doesNotMatch(answer.text, /valor não conferido/);
    assert.match(answer.source, /ferramentas: notas, caminhos_para_sobrar/);
  });
});

test("laço: no máximo 6 ferramentas; insistir depois disso termina em erro de protocolo, sem mensagem de alteração", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const tools = ["sobra_atual", "acima_do_normal", "notas", "mes_atual", "reservas", "contas_fixas"];
    const seen = fakeProvider([...tools.map((name) => ({ tool: { name } })), { tool: { name: "cartoes" } }]);
    const answer = (await askHelp(db, user, ask("Quanto sobra por mês?"))) as { text: string; trace: Record<string, unknown> };
    assert.equal(seen[6].input.ferramentas_restantes, 0);
    assert.ok(seen[6].input.aviso);
    assert.equal(seen.length, 6 + 1 + MAX_PROTOCOL_RETRIES, "6 ferramentas + pedido final + tentativas de protocolo");
    assert.equal(answer.text, PROTOCOL_FAILURE);
    assert.equal(answer.trace.executadas, 6);
    assert.equal(answer.trace.protocolo, MAX_PROTOCOL_RETRIES + 1);
  });
});

test("laço: pedido repetido não executa de novo nem gasta orçamento; repetir sem avançar para", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const seen = fakeProvider([
      { tool: { name: "sobra_atual" } },
      { tool: { name: "sobra_atual" } },
      { text: "Pronto.", action: null },
    ]);
    const answer = (await askHelp(db, user, ask("Quanto sobra?"))) as { text: string; trace: Record<string, unknown> };
    assert.equal(answer.text, "Pronto.");
    assert.equal(answer.trace.solicitadas, 2);
    assert.equal(answer.trace.executadas, 1);
    assert.equal(answer.trace.repetidas, 1);
    assert.equal(seen[2].input.ferramentas_restantes, 5, "a repetida não gastou orçamento");
    const stuck = fakeProvider([{ tool: { name: "notas" } }]);
    const stopped = (await askHelp(db, user, ask("Quanto sobra?"))) as { text: string };
    assert.equal(stopped.text, PROTOCOL_FAILURE);
    assert.ok(stuck.length <= 1 + MAX_PROTOCOL_RETRIES + 1);
  });
});

test("laço: argumento inválido volta como erro e o laço continua; JSON quebrado tem recuperação limitada", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const seen = fakeProvider([{ tool: { name: "buscar_movimentos", limite: 500 } }, "isto não é json", { text: "Ok.", action: null }]);
    const answer = (await askHelp(db, user, ask("Quanto gastamos?"))) as { text: string; trace: Record<string, unknown> };
    const first = (seen[1].input.tool_results as { resultado: { erro: string } }[])[0];
    assert.match(first.resultado.erro, /argumento inválido: limite/);
    assert.match(String(seen[2].input.aviso), /Formato inválido/);
    assert.equal(answer.text, "Ok.");
    assert.equal(answer.trace.invalidas, 1);
    assert.equal(answer.trace.protocolo, 1);
    fakeProvider(["nada", "nada", "nada", "nada"]);
    const broken = (await askHelp(db, user, ask("Quanto gastamos?"))) as { text: string };
    assert.equal(broken.text, PROTOCOL_FAILURE);
    assert.doesNotMatch(broken.text, /alteração/);
  });
});

test("laço: ferramenta inválida não quebra a pergunta; vira erro em tool_results", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const seen = fakeProvider([
      { tool: { name: "historico_categoria", categoria: "c999" } },
      { text: "Não achei essa categoria.", action: null },
    ]);
    const answer = await askHelp(db, user, ask("Como foi Pet nos últimos meses?"));
    const results = seen[1].input.tool_results as { resultado: { erro?: string } }[];
    assert.match(results[0].resultado.erro ?? "", /categoria/);
    assert.equal(answer.text, "Não achei essa categoria.");
  });
});

test("requestLlm: lista de modelos; cota esgotada (403 AllocationQuota) passa para o próximo", async () => {
  const { requestLlm } = await import("../src/server/llm.ts");
  const fetchOriginal = globalThis.fetch;
  const keys = ["AI_PROVIDER", "DASHSCOPE_API_KEY", "DASHSCOPE_MODEL", "DASHSCOPE_RETENTION_CONFIRMED"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    AI_PROVIDER: "dashscope",
    DASHSCOPE_API_KEY: "synthetic-key",
    DASHSCOPE_MODEL: "modelo-a,modelo-b",
    DASHSCOPE_RETENTION_CONFIRMED: "true",
  });
  const asked: string[] = [];
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const model = JSON.parse(init!.body!).model as string;
    asked.push(model);
    if (model === "modelo-a")
      return new Response(JSON.stringify({ code: "AllocationQuota.FreeTierOnly" }), { status: 403 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "oi" } }] });
  }) as typeof fetch;
  try {
    const payload = { model: "modelo-a,modelo-b", instructions: "x", input: "y" };
    assert.equal(await requestLlm(payload), "oi");
    assert.equal(await requestLlm(payload), "oi");
    assert.deepEqual(asked, ["modelo-a", "modelo-b", "modelo-b"], "o esgotado fica de fora na pergunta seguinte");
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("cache: instruções sem data; nos modelos com cache explícito, partes marcadas e a que muda por último", async () => {
  const { chatCompletionsPayload } = await import("../src/server/llm.ts");
  const p = { model: "qwen4-max", instructions: "fixo", input: '{"a":1}', inputTail: '{"b":2}', json: true };
  const cached = chatCompletionsPayload(p, "dashscope") as { messages: { content: unknown }[]; enable_thinking: boolean };
  assert.deepEqual(cached.messages[0].content, [{ type: "text", text: "fixo", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(cached.messages[1].content, [
    { type: "text", text: '{"a":1}', cache_control: { type: "ephemeral" } },
    { type: "text", text: '{"b":2}' },
  ]);
  assert.equal(cached.enable_thinking, false);
  // Sem cache explícito: um JSON só, como sempre.
  const plain = chatCompletionsPayload({ ...p, model: "qwen-plus" }, "dashscope") as { messages: { content: unknown }[] };
  assert.equal(plain.messages[1].content, '{"a":1,"b":2}');
  const { chatPayload } = await import("../src/server/help.ts");
  void chatPayload;
});

// Casa com lançamentos no mês atual: um iFood, um Pix para uma pessoa (com CPF)
// e o salário. Serve para conferir as ferramentas do copiloto.
async function familyWithMovements() {
  const { db, user } = await family();
  const { randomUUID } = await import("node:crypto");
  const { asUser } = await import("../src/server/db.ts");
  const { createManualEventTx } = await import("../src/server/manual.ts");
  const account = randomUUID();
  const delivery = randomUUID();
  const other = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Teste','BRL','checking',$3)",
    [account, user.familyId, user.userId],
  );
  await db.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Delivery'),($3,$2,'Outros')", [
    delivery,
    user.familyId,
    other,
  ]);
  const add = (description: string, amount: string, kind: string, category: string | null) =>
    asUser(db, user.userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account,
        date: `${month}-01`,
        description,
        amount,
        kind,
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
  await add("IFOOD *RESTAURANTE", "-45,00", "expense", delivery);
  await add("PIX ENVIADO MARIA DA SILVA 123.456.789-00", "-100,00", "expense", other);
  await add("Salário", "1000,00", "income", other);
  const catalog = {
    categories: [
      { id: delivery, name: "Delivery" },
      { id: other, name: "Outros" },
    ],
    accounts: [{ id: account, name: "Corrente", kind: "checking", currency: "BRL" as const }],
    goals: [],
  };
  return { db, user, catalog };
}

test("buscar_movimentos: os mesmos totais da tela Movimentos; sem nome de pessoa nem CPF no provedor", async () => {
  const { db, user } = await familyWithMovements();
  const { readState } = await import("../src/server/state.ts");
  const { movementRows, movementTotals, visibleMovements } = await import("../src/domain/movements.ts");
  await withProvider(async () => {
    const seen = fakeProvider([
      { tool: { name: "buscar_movimentos" } },
      { tool: { name: "maiores_gastos", agrupar: "nome" } },
      { text: "Pronto.", action: null },
    ]);
    await askHelp(db, user, ask("Quanto gastamos este mês?"));
    const results = seen[2].input.tool_results as { resultado: Record<string, unknown> }[];
    const search = results[0].resultado as {
      total_linhas: number;
      totais: { entrada_cents: string; saida_cents: string };
      linhas: { nome: string }[];
    };
    const screen = movementTotals(
      visibleMovements(movementRows(await readState(db, user, `${month}-01`, "BRL")), { query: "", filter: "all" }),
    );
    assert.equal(search.total_linhas, 3);
    assert.equal(search.totais.entrada_cents, screen.income);
    assert.equal(search.totais.saida_cents, screen.expense);
    assert.ok(search.linhas.some((l) => l.nome === "Pix enviado"));
    assert.ok(search.linhas.some((l) => l.nome === "Ifood *restaurante"));
    const sent = JSON.stringify(results);
    assert.doesNotMatch(sent, /maria|silva|123\.456/i, "o resultado das ferramentas não leva nome de pessoa nem CPF");
  });
});

test("ferramentas do copiloto: nenhuma grava; acima_do_normal sem histórico não quebra", async () => {
  const { db, user, catalog } = await familyWithMovements();
  const { runTool } = await import("../src/server/judite-tools.ts");
  const tables = ["economic_events", "ledger_entries", "goals", "monthly_items", "recurrence_occurrences", "card_cycles", "reserve_plans"];
  const count = async () =>
    Promise.all(tables.map(async (t) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n));
  const before = await count();
  const calls = [
    { name: "acima_do_normal" },
    { name: "buscar_movimentos", texto: "ifood", categoria: "c0", conta: "a0", tipo: "expense" },
    { name: "maiores_gastos", n: 5 },
    { name: "comparar_meses", mes_a: month, mes_b: month },
    { name: "mes_atual" },
    { name: "contas_fixas" },
    { name: "cartoes" },
    { name: "reservas" },
    { name: "simular", cenario: { everyday_weekly_cents: "50000" } },
  ] as const;
  const out: Record<string, unknown> = {};
  for (const call of calls) {
    try {
      out[call.name] = await runTool({ db, user, catalog, currency: "BRL", cache: {} }, call as never);
    } catch (error) {
      out[call.name] = { erro: String(error) };
    }
  }
  assert.deepEqual(await count(), before, "nenhuma ferramenta grava");
  assert.deepEqual(out.acima_do_normal, { sem_historico: true, motivo: "Ainda não há mês fechado com movimento." });
  const found = out.buscar_movimentos as { total_linhas: number; totais: { saida_cents: string } };
  assert.equal(found.total_linhas, 1);
  assert.equal(found.totais.saida_cents, "4500");
  const top = out.maiores_gastos as { linhas: { nome: string }[] };
  assert.deepEqual(top.linhas.map((l) => l.nome), ["Pix enviado", "Ifood *restaurante"]);
  for (const name of ["mes_atual", "contas_fixas", "cartoes", "reservas", "comparar_meses"])
    assert.ok(!(out[name] as { erro?: string }).erro, `${name}: ${JSON.stringify(out[name])}`);
});

test("schema das ferramentas: entrada inválida é recusada", async () => {
  const { toolCall } = await import("../src/server/judite-tools-schema.ts");
  const bad = [
    { name: "comparar_meses", mes_a: "2026-13", mes_b: "2026-10" },
    { name: "buscar_movimentos", limite: 500 },
    { name: "buscar_movimentos", de: "ontem" },
    { name: "maiores_gastos", n: 50 },
    { name: "acima_do_normal", alvo_pct: 8 },
    { name: "simular", cenario: {} },
  ];
  for (const tool of bad) assert.equal(toolCall.safeParse({ tool }).success, false, JSON.stringify(tool));
  assert.equal(toolCall.safeParse({ tool: { name: "buscar_movimentos", texto: "ifood" } }).success, true);
});

test("detalhar_categoria: total por etiqueta e itens, sem nome de pessoa", async () => {
  const { db, user, catalog } = await familyWithMovements();
  const { runTool } = await import("../src/server/judite-tools.ts");
  const { randomUUID } = await import("node:crypto");
  const tag = randomUUID();
  await db.query("INSERT INTO category_tags(id,household_id,category_id,name) VALUES($1,$2,$3,'Lanche')", [
    tag,
    user.familyId,
    catalog.categories[0].id,
  ]);
  await db.query("UPDATE economic_events SET tag_id=$1 WHERE household_id=$2 AND description LIKE 'IFOOD%'", [tag, user.familyId]);
  const out = (await runTool({ db, user, catalog, currency: "BRL", cache: {} }, { name: "detalhar_categoria", categoria: "c0" })) as {
    total_cents: string;
    etiquetas: { etiqueta: string; total_cents: string; itens: { nome: string; vezes: number }[] }[];
  };
  assert.equal(out.total_cents, "4500");
  assert.deepEqual(
    out.etiquetas.map((e) => [e.etiqueta, e.total_cents, e.itens.map((i) => i.nome)]),
    [["Lanche", "4500", ["Ifood *restaurante"]]],
  );
  const other = JSON.stringify(
    await runTool({ db, user, catalog, currency: "BRL", cache: {} }, { name: "detalhar_categoria", categoria: "c1" }),
  );
  assert.match(other, /Pix enviado/);
  assert.doesNotMatch(other, /maria|123\.456/i);
});

test("fatos G1 e L1: Pix vira 'Pix enviado', sem nome de pessoa nem CPF", async () => {
  const { db, user } = await familyWithMovements();
  const { readCategorySpend, readInsights } = await import("../src/server/insights.ts");
  const { insightsContext } = await import("../src/domain/insights-facts.ts");
  const spend = await readCategorySpend(db, user, month);
  const labels = spend.categories.flatMap((c) => c.items.map((i) => i.label));
  assert.ok(labels.includes("Pix enviado"));
  assert.doesNotMatch(JSON.stringify(labels), /maria|123\.456/i);
  const insights = await readInsights(db, user);
  const places = insightsContext(insights).places_year;
  assert.ok(places.some((p) => p.label === "Pix enviado"));
  assert.doesNotMatch(JSON.stringify(places), /maria|123\.456/i);
});

test("laço: texto e tool juntos na mesma resposta executam a ferramenta, sem cair no fallback", async () => {
  const { db, user } = await family();
  await withProvider(async () => {
    const seen = fakeProvider([
      { text: "Vou olhar a sobra.", action: null, tool: { name: "sobra_atual" } },
      { text: "E as categorias.", action: { tool: { name: "acima_do_normal" } } },
      { text: "Pronto.", action: null, tool: null },
    ]);
    const answer = await askHelp(db, user, ask("Quanto sobra?"));
    assert.equal(seen.length, 3);
    assert.equal((seen[2].input.tool_results as unknown[]).length, 2);
    assert.equal(answer.text, "Pronto.");
  });
});
