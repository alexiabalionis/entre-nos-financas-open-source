// Fase 3 da SPEC-JUDITE-VISAO-AMPLA: a ferramenta padroes sobre dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { addDays } from "../src/domain/day.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { runTool } from "../src/server/judite-tools.ts";
import { dedupHighlights } from "../src/server/judite-tools-patterns.ts";
import { checkMoney, formattedMoneyText, UNVERIFIED } from "../src/domain/money-check.ts";
import { listDays } from "../src/domain/spend-patterns-core.ts";
import { weekdayOf } from "../src/domain/spend-patterns-time.ts";
import type { Highlight } from "../src/domain/spend-patterns.ts";

type Wire = {
  periodo: { de: string; ate: string };
  meses: number;
  compras_analisadas: number;
  cobertura_hora: number;
  filtros?: Record<string, string>;
  destaques: {
    analise: string;
    recorte: { tipo: string; chave: string };
    corte: string;
    base: { corte_compras: number; corte_cents: string; recorte_compras: number; recorte_cents: string };
    alavancas: { tipo: string; cents: string; formatted: string }[];
    em_jogo_formatted: string;
  }[];
  sem_padrao: Record<string, unknown>;
};

/** Seis meses fechados: delivery concentrado na segunda, mais alguns Pix para uma pessoa. */
async function household(seed = true) {
  const db = await openDatabase();
  const email = "patterns@example.invalid";
  const userId = await createFamily(db, { name: "Pessoa fictícia", familyName: "Teste", email, password: "SenhaFicticia!2026" });
  const familyId = (await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])).rows[0]
    .household_id;
  const user: Identity = { userId, familyId, name: "Pessoa", email, role: "owner" };
  const account = randomUUID();
  const category = randomUUID();
  const other = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Teste','BRL','checking',$3)",
    [account, familyId, userId],
  );
  await db.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Delivery'),($3,$2,'Outros')", [category, familyId, other]);
  const add = (date: string, amount: string, description: string, id = category) =>
    asUser(db, userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account,
        date,
        description,
        amount,
        kind: "expense",
        category_id: id,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
  const current = settledToday().slice(0, 7);
  const first = shiftMonth(current, -6);
  const days = listDays(`${first}-01`, addDays(`${current}-01`, -1));
  const mondays = days.filter((d) => weekdayOf(d) === "segunda");
  const others = days.filter((d) => weekdayOf(d) !== "segunda").filter((_, k) => k % 9 === 0);
  if (seed) {
    for (const d of mondays) await add(d, "-50,00", "IFOOD PEDIDO");
    for (const d of others) await add(d, "-50,00", "IFOOD PEDIDO");
    for (const d of others.slice(0, 10)) await add(d, "-12,00", "Pix para Maria Silva Santos", other);
  }
  const catalog = {
    categories: [{ id: category, name: "Delivery" }],
    accounts: [{ id: account, name: "Corrente", kind: "checking", currency: "BRL" as const }],
    goals: [],
  };
  return { ctx: { db, user, catalog, currency: "BRL" as const, cache: {} }, days };
}

test("padroes: o total da categoria bate com detalhar_categoria no mesmo período", async () => {
  const { ctx } = await household();
  const out = (await runTool(ctx, { name: "padroes", categoria: "c0" })) as Wire;
  assert.deepEqual(out.filtros, { categoria: "Delivery" });
  assert.equal(out.meses, 6);
  const detail = (await runTool(ctx, { name: "detalhar_categoria", categoria: "c0", de: out.periodo.de, ate: out.periodo.ate })) as {
    total_cents: string;
  };
  const monday = out.destaques.find((h) => h.analise === "concentracao_tempo" && h.corte.includes("segunda"));
  assert.ok(monday, "a segunda aparece como destaque");
  assert.ok(monday.alavancas.some((l) => l.tipo === "uma_a_menos_por_semana"));
  // Mesma população e mesmo total da outra ferramenta (o recorte cobre a categoria inteira).
  assert.equal(monday.base.recorte_cents, detail.total_cents);
  // Só as compras da categoria entram: 26 segundas + 17 outros dias, sem os Pix de outra categoria.
  assert.equal(out.compras_analisadas, monday.base.recorte_compras);
});

test("padroes: sem nome depois de Pix, sem hora sem conta com hora, sem_padrao só com números", async () => {
  const { ctx } = await household();
  const out = (await runTool(ctx, { name: "padroes" })) as Wire;
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /Maria|Silva|Santos/);
  assert.ok(!out.destaques.some((h) => h.recorte.tipo === "lugar" && /pix/i.test(h.recorte.chave)));
  // Nenhuma conta com hora real: nada de eixo de hora e cobertura zero.
  assert.equal(out.cobertura_hora, 0);
  assert.doesNotMatch(text, /hora_do_dia|dia_da_semana_e_hora|madrugada|almoço|tarde da noite/);
  assert.ok(out.destaques.length > 0);
  assert.deepEqual(Object.keys(out.sem_padrao).sort(), ["aprovadas", "avaliadas"]);
  assert.ok(Object.values(out.sem_padrao).every((v) => Number.isInteger(v)));
  assert.ok(out.destaques.length <= 8);
});

test("padroes: checkMoney aceita um *_formatted da ferramenta como apurado e recusa o inventado", async () => {
  const { ctx } = await household();
  const out = (await runTool(ctx, { name: "padroes" })) as Wire;
  const lever = out.destaques.flatMap((h) => h.alavancas)[0];
  assert.ok(lever, "há uma alavanca");
  const financial = formattedMoneyText(out);
  const ok = checkMoney(`Uma a menos por semana devolve ${lever.formatted} por mês.`, { financial });
  assert.equal(ok.replaced, 0);
  assert.match(ok.text, /devolve R\$/);
  const bad = checkMoney("Devolve R$ 987.654,32 por mês.", { financial });
  assert.equal(bad.replaced, 1);
  assert.match(bad.text, new RegExp(UNVERIFIED.replace(/[[\]]/g, "\\$&")));
});

test("padroes: menos de 3 meses fechados com gasto recusa com frase clara", async () => {
  const { ctx } = await household(false);
  await assert.rejects(runTool(ctx, { name: "padroes" }), /3 meses fechados/);
});

const lever = { tipo: "uma_a_menos_por_semana" as const, cents: 20000n };
const highlight = (tipo: Highlight["recorte"]["tipo"], chave: string, cut = 14, cents = 70000n): Highlight => ({
  analise: "concentracao_tempo",
  recorte: { tipo, chave },
  corte: "dia_da_semana: segunda",
  base: { corte_compras: cut, corte_cents: cents, recorte_compras: 40, recorte_cents: 200000n },
  indice: 2,
  metades: [2, 2],
  alavancas: [lever],
  em_jogo_cents: 20000n, em_jogo_natureza: "alavanca",
});

test("deduplicação: o mesmo padrão e a mesma base ficam só no recorte mais específico", () => {
  const all = [
    highlight("casa", "casa"),
    highlight("categoria", "Delivery"),
    highlight("lugar", "IFood"),
    highlight("conta", "Corrente"),
  ];
  assert.deepEqual(dedupHighlights(all).map((h) => h.recorte.tipo), ["lugar"]);
  // Outra base de compras (não é o mesmo padrão): os dois ficam.
  const other = highlight("casa", "casa", 15, 75000n);
  assert.deepEqual(dedupHighlights([highlight("categoria", "Delivery"), other]).map((h) => h.recorte.tipo), ["categoria", "casa"]);
  // Ordem de especificidade: etiqueta > categoria > conta > forma > casa.
  const order = ["casa", "pagamento", "conta", "categoria", "etiqueta"] as const;
  for (let k = 1; k < order.length; k++)
    assert.equal(dedupHighlights([highlight(order[k - 1], "x"), highlight(order[k], "y")])[0].recorte.tipo, order[k]);
});

/** Saídas do banco ainda pendentes (contam sozinhas), uma por segunda, com a hora de `at(dia, k)`. */
async function bankMondays(h: Awaited<ReturnType<typeof household>>, at: (day: string, k: number) => string) {
  const { db, user } = h.ctx;
  const account = randomUUID();
  const connection = randomUUID();
  const bankAccount = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Banco','Teste','BRL','checking',$3)",
    [account, user.familyId, user.userId],
  );
  await db.query("INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')", [user.familyId, user.userId]);
  await db.query(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2020-01-01')",
    [connection, user.familyId, user.userId, randomUUID()],
  );
  await db.query(
    "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Banco','BRL','BANK',$5)",
    [bankAccount, user.familyId, connection, randomUUID(), account],
  );
  const mondays = h.days.filter((d) => weekdayOf(d) === "segunda");
  for (const [k, day] of mondays.entries())
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,transaction_at,description,amount_cents,currency,provider_status,payload_hash,last_seen_run)
       VALUES($1,$2,$3,$4,$5,$6,$7,'PADARIA ZE',-4000,'BRL','POSTED','synthetic',$8)`,
      [randomUUID(), user.familyId, bankAccount, account, randomUUID(), day, at(day, k), randomUUID()],
    );
  return mondays.length;
}

test("padroes: conta cujas horas são todas iguais é sem_hora e não gera nada de hora", async () => {
  const h = await household(false);
  const n = await bankMondays(h, (day) => `${day}T03:00:00.000Z`);
  const out = (await runTool(h.ctx, { name: "padroes" })) as Wire;
  assert.equal(out.compras_analisadas, n, "as saídas pendentes do banco entram na leitura");
  assert.equal(out.cobertura_hora, 0);
  assert.doesNotMatch(JSON.stringify(out), /hora_do_dia|dia_da_semana_e_hora|madrugada|almoço|tarde da noite/);
});

test("padroes: conta com horas variadas é com_hora e a cobertura de hora vem da ferramenta", async () => {
  const h = await household(false);
  const n = await bankMondays(h, (day, k) => `${day}T${String(15 + (k % 4)).padStart(2, "0")}:${String(10 + k).padStart(2, "0")}:00.000Z`);
  const out = (await runTool(h.ctx, { name: "padroes" })) as Wire;
  assert.equal(out.compras_analisadas, n);
  assert.equal(out.cobertura_hora, 1);
});

test("padroes: com o diagnóstico ligado a resposta é a mesma e o arquivo traz universo, candidatos, seleção e sobreposições", async () => {
  const { ctx } = await household();
  const off = (await runTool(ctx, { name: "padroes" })) as Wire;
  const dir = await mkdtemp(path.join(tmpdir(), "padroes-trace-"));
  process.env.JUDITE_PATTERNS_TRACE = "1";
  process.env.JUDITE_PATTERNS_TRACE_DIR = dir;
  try {
    const on = (await runTool({ ...ctx, cache: {} }, { name: "padroes" })) as Wire;
    assert.deepEqual(on, off);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const text = await readFile(path.join(dir, files[0]!), "utf8");
    const report = JSON.parse(text) as {
      formato: number;
      execucao: string;
      universo: { compras_no_filtro: number; compras_analisadas: number };
      candidatos: { status: string; motivo: string | null; corte_ids: string[] | null }[];
      selecao: { status: string; ref: string | null }[];
      sobreposicoes: unknown[];
    };
    assert.equal(report.formato, 1);
    assert.match(report.execucao, /^[0-9a-f-]{36}$/);
    assert.equal(report.universo.compras_analisadas, off.compras_analisadas);
    assert.equal(report.selecao.filter((s) => s.status === "enviado").length, off.destaques.length);
    assert.ok(report.candidatos.some((c) => c.status === "rejeitado" && c.motivo !== null));
    assert.ok(report.candidatos.filter((c) => c.status === "aprovado").every((c) => c.corte_ids!.every((id) => id !== "")));
    assert.ok(Array.isArray(report.sobreposicoes));
    // Nome de pessoa da descrição do Pix não vai para o arquivo.
    assert.doesNotMatch(text, /Maria|Silva|Santos/);
  } finally {
    delete process.env.JUDITE_PATTERNS_TRACE;
    delete process.env.JUDITE_PATTERNS_TRACE_DIR;
  }
});
