import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, type Database } from "../src/server/db.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { addDays } from "../src/domain/day.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { evidenceOf, initialPrefetch, budgetFreePrefetch } from "../src/server/judite-evidence.ts";
import { catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { day, openLedger, type Ledger } from "../scripts/judite-eval-scenarios.ts";

type Horizon = { de: string; ate: string; itens: { tipo: string; data: string; rotulo: string; cents?: string; por_que: string }[]; sem_itens?: true };

const today = settledToday();
const ahead = (n: number) => addDays(today, n);

async function cardWithBill(db: Database, l: Ledger, name: string, dueIn: number) {
  const due = ahead(dueIn);
  const close = ahead(dueIn - 7);
  const [account, bankAccount, connection] = [randomUUID(), randomUUID(), randomUUID()];
  await db.query(`INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')`, [l.user.familyId, l.user.userId]);
  await db.query(`INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2020-01-01')`, [connection, l.user.familyId, l.user.userId, randomUUID()]);
  await db.query(`INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Banco Fictício','BRL','card',$4)`, [account, l.user.familyId, name, l.user.userId]);
  await db.query(
    `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,$5,'BRL','CREDIT',$6)`,
    [bankAccount, l.user.familyId, connection, randomUUID(), name, account],
  );
  await saveCardCycle(db, l.user, { account_id: account, close_date: shiftMonth(close.slice(0, 7), -2) + close.slice(7), due_date: shiftMonth(due.slice(0, 7), -2) + due.slice(7) }, { today: day(2, 1) });
  await db.query(
    `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,card_meta)
     VALUES($1,$2,$3,$4,$5,$6,'LOJA DE ROUPAS',$7,'BRL','POSTED','synthetic',$8,'{}')`,
    [randomUUID(), l.user.familyId, bankAccount, account, randomUUID(), ahead(-1), -60000, randomUUID()],
  );
  return account;
}

/** Fim de mês de um mês cuja data cai depois da fatura e dentro do horizonte. */
const reserveMonth = () => {
  const here = today.slice(0, 7);
  const end = (m: string) => addDays(`${shiftMonth(m, 1)}-01`, -1);
  return end(here) > ahead(10) && end(here) <= ahead(45) ? here : shiftMonth(here, 1);
};

async function build(db: Database) {
  const l = await openLedger(db, 0, "horizon");
  const moradia = await l.category("Moradia");
  const card = await cardWithBill(db, l, "Cartão Roxo", 10);
  const bill = (label: string, dueIn: number, account?: string) =>
    createRecurrence(db, l.user, { purpose: "expense", label, category_id: moradia, expected_cents: 12000, frequency: "month", start_date: ahead(dueIn), ...(account ? { account_id: account } : {}) });
  await bill("Internet", 5);
  await bill("Streaming", 6, card);
  await createGoal(db, l.user, { name: "Viagem", target: "3000,00", deadline_month: reserveMonth() });
  const dueIpva = ahead(20);
  await db.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,created_by) VALUES($1,$2,$3,'IPVA','expense','BRL',250000,$4,$5)`,
    [randomUUID(), l.user.familyId, `${dueIpva.slice(0, 7)}-01`, dueIpva, l.user.userId],
  );
  const catalog = await catalogFor(db, l.user);
  const ctx = (): ToolContext => ({ db, user: l.user, catalog, currency: "BRL", cache: {} });
  return { l, ctx };
}

const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** Gasto avulso nos 3 meses fechados, só em dias de fim de semana ou só em dia útil. */
async function spendOn(l: Ledger, weekend: boolean) {
  const lazer = await l.category("Lazer");
  for (const back of [1, 2, 3]) {
    for (let d = 1; d <= 28; d++) {
      const date = day(back, d);
      const wd = weekdayOf(date);
      if (((wd === 0 || wd === 6) === weekend) && d % 2 === 0) await l.add("expense", date, 50, lazer, `LANCHE ${d}`);
    }
  }
}

test("proximas_decisoes: fatura em 10 dias e reserva com prazo vêm na ordem, com por_que", async () => {
  const db = await openDatabase();
  const { ctx } = await build(db);
  const out = (await runTool(ctx(), { name: "proximas_decisoes" })) as Horizon;
  const kinds = out.itens.map((i) => i.tipo);
  assert.deepEqual(kinds.filter((k) => k !== "conta_fixa"), ["fatura", "evento_planejado", "reserva"]);
  const dates = out.itens.map((i) => i.data);
  assert.deepEqual(dates, [...dates].sort());
  const fatura = out.itens.find((i) => i.tipo === "fatura")!;
  assert.equal(fatura.data, ahead(10));
  assert.equal(fatura.cents, "60000");
  assert.ok(out.itens.every((i) => i.por_que.length > 0));
  assert.equal(out.itens.find((i) => i.tipo === "evento_planejado")!.rotulo, "IPVA");
  assert.equal(out.sem_itens, undefined);
});

test("proximas_decisoes: conta fixa cobrada no cartão não aparece à parte (já está na fatura)", async () => {
  const db = await openDatabase();
  const { ctx } = await build(db);
  const months = [0, 1, 2].map((k) => shiftMonth(today.slice(0, 7), k));
  const all = await Promise.all(months.map((mes) => runTool(ctx(), { name: "contas_fixas", mes }) as Promise<{ contas: { nome: string; cartao?: string }[] }>));
  const streaming = all.flatMap((r) => r.contas).find((c) => c.nome === "Streaming");
  assert.equal(streaming?.cartao, "Cartão Roxo", JSON.stringify(all));
  const out = (await runTool(ctx(), { name: "proximas_decisoes" })) as Horizon;
  const fixed = out.itens.filter((i) => i.tipo === "conta_fixa").map((i) => i.rotulo);
  assert.ok(fixed.includes("Internet"));
  assert.ok(!fixed.includes("Streaming"));
  assert.ok(!JSON.stringify(out).includes("Streaming"));
});

test("proximas_decisoes: conta fixa vinda de um Pix não leva o nome de quem recebe", async () => {
  const db = await openDatabase();
  const l = await openLedger(db, 3, "horizon-pix");
  const moradia = await l.category("Moradia");
  for (const [label, dueIn] of [["Pix enviado ROBERTO FICTICIO SOUZA", 5], ["Aulas de bateria", 6]] as const)
    await createRecurrence(db, l.user, { purpose: "expense", label, category_id: moradia, expected_cents: 12000, frequency: "month", start_date: ahead(dueIn) });
  const ctx: ToolContext = { db, user: l.user, catalog: await catalogFor(db, l.user), currency: "BRL", cache: {} };
  const json = JSON.stringify(await runTool(ctx, { name: "proximas_decisoes" }));
  assert.doesNotMatch(json, /ROBERTO|SOUZA/i);
  assert.match(json, /"rotulo":"Pix enviado"/);
  assert.match(json, /Aulas de bateria/);
});

test("proximas_decisoes: família sem nada marcado devolve lista vazia e sem_itens", async () => {
  const db = await openDatabase();
  const l = await openLedger(db, 1, "horizon-empty");
  const ctx: ToolContext = { db, user: l.user, catalog: await catalogFor(db, l.user), currency: "BRL", cache: {} };
  const out = (await runTool(ctx, { name: "proximas_decisoes" })) as Horizon;
  assert.deepEqual(out.itens, []);
  assert.equal(out.sem_itens, true);
});

test("proximas_decisoes: fim de semana só entra quando sábado e domingo levam mais de 40% do gasto avulso", async () => {
  const db = await openDatabase();
  const heavy = await openLedger(db, 2, "horizon-weekend");
  await spendOn(heavy, true);
  const light = await openLedger(db, 3, "horizon-weekday");
  await spendOn(light, false);
  const run = async (l: Ledger) =>
    (await runTool({ db, user: l.user, catalog: await catalogFor(db, l.user), currency: "BRL", cache: {} }, { name: "proximas_decisoes" })) as Horizon;
  const withWeekend = await run(heavy);
  assert.deepEqual(withWeekend.itens.map((i) => i.tipo), ["fim_de_semana"]);
  assert.ok([0, 6].includes(weekdayOf(withWeekend.itens[0]!.data)));
  assert.equal(withWeekend.itens[0]!.cents, undefined);
  assert.deepEqual((await run(light)).itens, []);
});

test("proximas_decisoes: evidenceOf cobre fixas e cartões (e reservas quando há reserva); sem item, nada", async () => {
  const db = await openDatabase();
  const { ctx } = await build(db);
  const resultado = await runTool(ctx(), { name: "proximas_decisoes" });
  const evidence = evidenceOf({ chamada: { name: "proximas_decisoes" }, resultado });
  assert.deepEqual(evidence, [{ kind: "obrigacoes", covers: ["fixas", "cartoes"] }, { kind: "reservas" }]);
  assert.deepEqual(evidenceOf({ chamada: { name: "proximas_decisoes" }, resultado: { itens: [], sem_itens: true } }), []);
});

test("prefetch: proximas_decisoes em toda a rota aberta (e no diagnóstico), depois de abertura, fora do orçamento; basic tira", () => {
  const diag = { question: "O que eu poderia fazer diferente nas finanças?", activeMemories: 0, open: true };
  const names = (p: Parameters<typeof initialPrefetch>[0]) => initialPrefetch(p).map((c) => c.name);
  assert.deepEqual(names(diag), ["padroes", "renda_por_tipo", "avisos_de_dados", "abertura", "proximas_decisoes"]);
  assert.deepEqual(names({ question: "E no mercado?", activeMemories: 0, open: true }), ["abertura", "proximas_decisoes"]);
  assert.equal(budgetFreePrefetch({ name: "proximas_decisoes" }), true);
  const saved = process.env.JUDITE_DIAG_PREFETCH;
  process.env.JUDITE_DIAG_PREFETCH = "basic";
  try {
    assert.deepEqual(names(diag), ["padroes"]);
  } finally {
    if (saved === undefined) delete process.env.JUDITE_DIAG_PREFETCH;
    else process.env.JUDITE_DIAG_PREFETCH = saved;
  }
});
