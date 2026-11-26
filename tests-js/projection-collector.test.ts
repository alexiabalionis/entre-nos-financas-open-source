import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import {
  createFamily,
  issueSession,
  identity,
  type Identity,
} from "../src/server/auth.ts";
import {
  readProjection,
  toProjectionWire,
} from "../src/server/projection.ts";
import { stalenessFrom } from "../src/server/projection-reads-cash.ts";
import { seedIncomeOccurrence, seedIncomeSeries } from "./income-seed.ts";

// F1a do Copiloto: o coletor readProjection lê o banco da família e monta a
// entrada do motor puro. Banco PGlite em memória (openDatabase sem diretório).
// "Hoje" fixado em 2026-11-09 (uma segunda-feira) via opts.today para a
// projeção ser determinística.
const TODAY = "2026-11-09";

let db: PGlite;
let a: Identity;
let b: Identity;
let c: Identity;
let bank: string;
let investment: string;

async function run(sql: string, params: unknown[] = []) {
  return asUser(db, a.userId, (tx) => tx.query(sql, params));
}

async function account(
  user: Identity,
  name: string,
  kind = "checking",
  currency = "BRL",
) {
  const id = randomUUID();
  await asUser(db, user.userId, (tx) =>
    tx.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8)",
      [
        id,
        user.familyId,
        name,
        "Instituição fictícia",
        currency,
        kind,
        "2025-12-31",
        user.userId,
      ],
    ),
  );
  return id;
}

before(async () => {
  db = await openDatabase();
  for (const [email, name] of [
    ["coletor-a@example.invalid", "Família coletor A"],
    ["coletor-b@example.invalid", "Família coletor B"],
    ["coletor-c@example.invalid", "Família coletor C"],
  ])
    await createFamily(db, {
      email,
      name,
      password: "SenhaFicticia!2026",
      familyName: name,
    });
  const users = (
    await db.query<{ id: string; email: string }>(
      "SELECT id,email FROM users WHERE email LIKE 'coletor-%' ORDER BY email",
    )
  ).rows;
  a = (await identity(db, await issueSession(db, users[0].id)))!;
  b = (await identity(db, await issueSession(db, users[1].id)))!;
  c = (await identity(db, await issueSession(db, users[2].id)))!;

  // Conta corrente BRL criada DEPOIS da migration 023. Com include_in_cash NULL
  // (sem default), a regra efetiva (coalesce) a inclui por padrão — sem precisar
  // marcar nada. É o cerne do bug corrigido: antes ela nasceria fora do caixa.
  bank = await account(a, "Banco coletor A");
  // Saldo informado à mão (sem banco conectado): balance_confirmed_*.
  await run(
    "UPDATE accounts SET balance_confirmed_cents=500000,balance_confirmed_at=$2 WHERE id=$1",
    [bank, TODAY],
  );

  // Conta de investimento: NÃO entra no caixa por padrão (não é checking BRL).
  investment = await account(a, "Investimento coletor A", "investment");

  // Item do plano com vencimento neste mês.
  await run(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,status,created_by)
     VALUES($1,$2,'2026-11-01','Aluguel','expense','BRL',120000,'2026-11-18','open',$3)`,
    [randomUUID(), a.familyId, a.userId],
  );

  // Cartão com ciclo (fecha dia 25, vence dia 5 do mês seguinte) e fatura
  // manual de novembro ainda não paga.
  const cardAccount = await account(a, "Cartão coletor A", "card");
  await run(
    `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by)
     VALUES($1,$2,$3,25,5,1,'2026-01-01','2026-01-01',$4)`,
    [randomUUID(), a.familyId, cardAccount, a.userId],
  );
  await run(
    `INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by)
     VALUES($1,$2,'2026-11-01',80000,'2026-11-05',false,$3)`,
    [a.familyId, cardAccount, a.userId],
  );

  // Recebimento previsto futuro (salário dia 20), planejado.
  const ruleId = await seedIncomeSeries(run, {
    familyId: a.familyId,
    userId: a.userId,
    accountId: bank,
    day: 20,
    cents: 600000,
  });
  const incomeItem = randomUUID();
  await run(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,status,created_by)
     VALUES($1,$2,'2026-11-01','Salário','income','BRL',600000,'open',$3)`,
    [incomeItem, a.familyId, a.userId],
  );
  await seedIncomeOccurrence(run, {
    familyId: a.familyId,
    recurrenceId: ruleId,
    itemId: incomeItem,
    occurrenceDate: "2026-11-20",
    expectedDate: "2026-11-20",
    state: "planned",
  });
});

after(async () => {
  await db?.close();
});

test("readProjection monta fluxos, estado coerente e saldo só das contas incluídas", async () => {
  const report = await readProjection(db, a, { today: TODAY });

  assert.equal(report.today, TODAY);
  // sConf vem só da conta corrente informada (500000); investimento fica fora.
  assert.equal(report.sConf, 500000n);
  assert.equal(report.snapshotDate, TODAY);

  // Fluxos esperados: item do plano (aluguel), fatura manual do cartão e o
  // recebimento previsto. Cada obrigação aparece uma vez.
  const keys = report.flows.map((f) => f.key);
  assert.ok(
    keys.some((k) => k.startsWith("item:")),
    "fluxo do item do plano",
  );
  assert.ok(
    keys.some((k) => k.startsWith("bill:")),
    "fluxo da fatura do cartão",
  );
  assert.ok(
    keys.some((k) => k.startsWith("inc:")),
    "fluxo do recebimento previsto",
  );

  // Fluxos ordenados por data de nom.
  const dates = report.flows.map((f) => f.nom.date);
  assert.deepEqual([...dates].sort(), dates);

  // Estado é um dos valores conhecidos; com folga grande deve ser CONFIRMADO.
  assert.ok(
    [
      "CONFIRMADO",
      "COM_RESSALVA",
      "DEPENDE_DE_DADOS",
      "SEM_FOLGA",
      "INDETERMINADO",
    ].includes(report.state),
  );
  assert.equal(report.state, "CONFIRMADO");

  // F2 expõe `shown` (número que pode ir pra tela); `cCons` cru continua fora.
  // Com estado CONFIRMADO há número, logo shown é bigint.
  assert.equal(typeof report.shown, "bigint");
  assert.ok(!("cCons" in (report as Record<string, unknown>)));

  // nextIncomeDate = primeiro recebimento futuro (>today) não detectado: o
  // salário previsto para 20/11.
  assert.equal(report.nextIncomeDate, "2026-11-20");

  // Série comprimida: só dias com mudança, começando em today.
  assert.ok(report.series.length > 0);
  assert.equal(report.series[0].day, TODAY);
  // O último dia sempre entra: o gráfico vai até o fim do horizonte.
  assert.equal(report.series[report.series.length - 1].day, report.horizonEnd);
});

test("F2: shown preenchido em COM_RESSALVA/CONFIRMADO, null nos demais; nextIncomeDate = 1º recebimento futuro não detectado", async () => {
  // Família A tem folga e salário previsto 20/11 -> CONFIRMADO: shown é um
  // número pronto pra tela e nextIncomeDate aponta o salário futuro.
  const reportA = await readProjection(db, a, { today: TODAY });
  assert.ok(["COM_RESSALVA", "CONFIRMADO"].includes(reportA.state));
  assert.equal(typeof reportA.shown, "bigint");
  assert.ok((reportA.shown as bigint) > 0n);
  assert.equal(reportA.nextIncomeDate, "2026-11-20");

  // Família B não tem conta, fluxo nem regra de recebimento: income em aberto
  // vira lacuna sem teto -> INDETERMINADO. Sem número pra tela (shown null) e
  // sem recebimento futuro conhecido (nextIncomeDate null).
  const reportB = await readProjection(db, b, { today: TODAY });
  assert.equal(reportB.state, "INDETERMINADO");
  assert.equal(reportB.shown, null);
  assert.equal(reportB.nextIncomeDate, null);
});

test("regra de inclusão no caixa: padrão checking BRL, override explícito e outros tipos fora", async () => {
  // Conta corrente BRL nova (include_in_cash NULL): entra por padrão, sem marcar
  // nada. Damos um saldo informado para ela somar ao sConf.
  const defaultChecking = await account(c, "Corrente padrão C");
  await asUser(db, c.userId, (tx) =>
    tx.query(
      "UPDATE accounts SET balance_confirmed_cents=100000,balance_confirmed_at=$2 WHERE id=$1",
      [defaultChecking, TODAY],
    ),
  );

  // include_in_cash=false numa conta corrente BRL a TIRA do caixa.
  const excludedChecking = await account(c, "Corrente excluída C");
  await asUser(db, c.userId, (tx) =>
    tx.query(
      "UPDATE accounts SET include_in_cash=false,balance_confirmed_cents=50000,balance_confirmed_at=$2 WHERE id=$1",
      [excludedChecking, TODAY],
    ),
  );

  // Conta de investimento com include_in_cash=true ENTRA no caixa (override).
  const includedInvestment = await account(
    c,
    "Investimento incluído C",
    "investment",
  );
  await asUser(db, c.userId, (tx) =>
    tx.query(
      "UPDATE accounts SET include_in_cash=true,balance_confirmed_cents=70000,balance_confirmed_at=$2 WHERE id=$1",
      [includedInvestment, TODAY],
    ),
  );

  // USD e cartão (NULL): ficam fora por padrão (não são checking BRL).
  const usdChecking = await account(c, "Corrente USD C", "checking", "USD");
  await asUser(db, c.userId, (tx) =>
    tx.query(
      "UPDATE accounts SET balance_confirmed_cents=900000,balance_confirmed_at=$2 WHERE id=$1",
      [usdChecking, TODAY],
    ),
  );
  const cardC = await account(c, "Cartão C", "card");
  await asUser(db, c.userId, (tx) =>
    tx.query(
      "UPDATE accounts SET balance_confirmed_cents=800000,balance_confirmed_at=$2 WHERE id=$1",
      [cardC, TODAY],
    ),
  );

  // sConf = corrente padrão (100000) + investimento incluído (70000) = 170000.
  // A corrente excluída, a USD e o cartão não somam.
  const report = await readProjection(db, c, { today: TODAY });
  assert.equal(report.sConf, 170000n);
});

test("fatura do cartão não é contada duas vezes (manual + estimativa)", async () => {
  const report = await readProjection(db, a, { today: TODAY });
  // A fatura manual de novembro (80000) gera um único fluxo bill: para o cartão
  // naquele mês; a estimativa não soma um segundo fluxo do mesmo mês/cartão.
  const novBills = report.flows.filter((f) =>
    /^bill:[^:]+:2026-11$/.test(f.key),
  );
  assert.equal(novBills.length, 1, "uma única fatura de novembro");
  assert.equal(novBills[0].cons.cents, 80000n);
});

test("horizonte termina na véspera do próximo recebimento futuro", async () => {
  const report = await readProjection(db, a, { today: TODAY });
  // Próximo recebimento futuro: salário 20/11, então horizonEnd = 19/11.
  assert.equal(report.horizonEnd, "2026-11-19");
  assert.ok(report.horizonEnd >= TODAY);
});

test("RLS: outra família não enxerga nada da família A", async () => {
  const report = await readProjection(db, b, { today: TODAY });
  assert.equal(report.sConf, 0n);
  assert.equal(report.flows.length, 0);
  assert.equal(report.snapshotDate, null);
});

test("staleness.dailyRate = maior soma semanal (seg-dom) das 12 semanas / 7 (floor), contas incluídas e cartões", async () => {
  // Família dedicada para não interferir nos outros testes.
  const checking = await account(b, "Corrente staleness B");
  const card = await account(b, "Cartão staleness B", "card");
  const usd = await account(b, "Corrente USD staleness B", "checking", "USD");

  // Evento + duas pernas de ledger balanceadas (conta + contrapartida nominal),
  // numa transação só: o trigger balanced_event é DEFERRABLE e checa no COMMIT.
  const addEvent = async (
    acc: string,
    kind: string,
    date: string,
    cents: number,
    currency = "BRL",
  ) => {
    const eventId = randomUUID();
    await asUser(db, b.userId, async (tx) => {
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
        [
          eventId,
          b.familyId,
          acc,
          kind,
          date,
          `${kind} ${date}`,
          cents,
          currency,
          b.userId,
        ],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,$7,$5,$8),($6,$2,$3,NULL,$9,$7,$10,$8)`,
        [
          randomUUID(),
          b.familyId,
          eventId,
          acc,
          cents,
          randomUUID(),
          currency,
          date,
          kind,
          -cents,
        ],
      );
    });
  };

  // TODAY=2026-11-09 é segunda; a semana parcial que o contém (a partir de
  // 2026-11-09) fica de fora. Janela = 12 semanas completas: [2026-08-17, 2026-11-09).
  // Semana A (seg 2026-10-26 a dom 2026-11-01), conta corrente incluída: 40000.
  await addEvent(checking, "expense", "2026-10-28", -40000);
  // Semana B (seg 2026-11-02 a dom 2026-11-08): corrente 20000 + cartão 30000.
  // O cartão SÓ conta porque a regra inclui 'contas incluídas E cartões'; é ele
  // que faz a semana B (50000) superar a semana A (40000) e virar o pico.
  await addEvent(checking, "expense", "2026-11-03", -20000);
  await addEvent(card, "card_purchase", "2026-11-04", -30000);
  // Ruídos que NÃO podem contar:
  // - evento na semana parcial de today (2026-11-09): excluído pela janela.
  await addEvent(checking, "expense", "2026-11-09", -999999);
  // - evento antes da janela (2026-08-10): excluído.
  await addEvent(checking, "expense", "2026-08-10", -888888);
  // - despesa em USD na semana B: excluída pela moeda.
  await addEvent(usd, "expense", "2026-11-05", -700000, "USD");
  // - renda/transferência na semana B: excluídas pelo kind.
  await addEvent(checking, "income", "2026-11-06", 777777);

  // snapshotDate 7 dias antes de today -> days=7. dailyRate = floor(50000/7)=7142.
  const stale = await asUser(db, b.userId, (tx) =>
    stalenessFrom(tx, b.familyId, "2026-11-02", TODAY),
  );
  assert.ok(stale !== null);
  assert.equal(stale.days, 7);
  assert.equal(stale.dailyRate, 7142n);

  // Sem snapshot -> null. days<=0 (snapshot = today) -> null.
  assert.equal(
    await asUser(db, b.userId, (tx) =>
      stalenessFrom(tx, b.familyId, null, TODAY),
    ),
    null,
  );
  assert.equal(
    await asUser(db, b.userId, (tx) =>
      stalenessFrom(tx, b.familyId, TODAY, TODAY),
    ),
    null,
  );
});

test("migration 023 é idempotente e não altera nenhuma linha de inclusão", async () => {
  const sql = await (
    await import("node:fs/promises")
  ).readFile("db/migrations/023_copilot_perimeter.sql", "utf8");
  // Flag bruta de cada conta ANTES de reaplicar (inclui os NULL, ordenado).
  const flagsBefore = (
    await db.query<{ id: string; flag: boolean | null }>(
      "SELECT id,include_in_cash AS flag FROM accounts ORDER BY id",
    )
  ).rows;
  // Reaplicar o corpo inteiro duas vezes não pode falhar: ADD COLUMN IF NOT
  // EXISTS, CREATE TABLE IF NOT EXISTS e policies criadas só quando ausentes.
  await db.exec(sql);
  await db.exec(sql);
  const flagsAfter = (
    await db.query<{ id: string; flag: boolean | null }>(
      "SELECT id,include_in_cash AS flag FROM accounts ORDER BY id",
    )
  ).rows;
  // A migration não tem mais UPDATE: nenhuma linha muda (nem os NULL viram true).
  assert.deepEqual(flagsAfter, flagsBefore);
  // A conta corrente BRL de A segue NULL (nunca marcada); mesmo assim entra no
  // caixa pela regra efetiva (coalesce), não por um flag gravado.
  const bankFlag = (
    await db.query<{ flag: boolean | null }>(
      "SELECT include_in_cash AS flag FROM accounts WHERE id=$1",
      [bank],
    )
  ).rows[0].flag;
  assert.equal(bankFlag, null);
  // A conta de investimento (sem override) segue NULL e fora do caixa.
  const investFlag = (
    await db.query<{ flag: boolean | null }>(
      "SELECT include_in_cash AS flag FROM accounts WHERE id=$1",
      [investment],
    )
  ).rows[0].flag;
  assert.equal(investFlag, null);
});

test("F1a nomes: cada fluxo ganha label (nunca vazio) e category (null quando não se aplica) por lookup da key", async () => {
  // Família dedicada para montar sched/bill/item sem interferir nos outros
  // testes: item do plano COM categoria, fatura de cartão e uma saída agendada
  // (bank_transaction pendente) numa conta corrente.
  await createFamily(db, {
    email: "nomes-flow@example.invalid",
    name: "Família nomes",
    password: "SenhaFicticia!2026",
    familyName: "Família nomes",
  });
  const user = (await identity(
    db,
    await issueSession(
      db,
      (
        await db.query<{ id: string }>(
          "SELECT id FROM users WHERE email='nomes-flow@example.invalid'",
        )
      ).rows[0].id,
    ),
  ))!;
  const runAs = (sql: string, params: unknown[] = []) =>
    asUser(db, user.userId, (tx) => tx.query(sql, params));

  // Conta corrente com saldo informado (folga para a projeção rodar).
  const checking = await account(user, "Corrente nomes");
  await runAs(
    "UPDATE accounts SET balance_confirmed_cents=1000000,balance_confirmed_at=$2 WHERE id=$1",
    [checking, TODAY],
  );

  // Categoria + item do plano referenciando-a: label e category do item vêm
  // daqui (item: -> monthly_items.label / categories.name).
  const categoryId = randomUUID();
  await runAs(
    "INSERT INTO categories(id,household_id,name,essential) VALUES($1,$2,'Categoria nomes',true)",
    [categoryId, user.familyId],
  );
  await runAs(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,status,created_by)
     VALUES($1,$2,'2026-11-01','Conta de luz','expense','BRL',30000,$3,'2026-11-22','open',$4)`,
    [randomUUID(), user.familyId, categoryId, user.userId],
  );

  // Cartão com ciclo + fatura manual não paga: gera o fluxo bill:.
  const cardAccount = await account(user, "Cartão nomes", "card");
  await runAs(
    `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by)
     VALUES($1,$2,$3,25,5,1,'2026-01-01','2026-01-01',$4)`,
    [randomUUID(), user.familyId, cardAccount, user.userId],
  );
  await runAs(
    `INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by)
     VALUES($1,$2,'2026-11-01',50000,'2026-11-05',false,$3)`,
    [user.familyId, cardAccount, user.userId],
  );

  // Conexão + mapeamento de conta do banco para a saída agendada
  // (bank_transactions.local_account_id = conta corrente).
  const connection = randomUUID();
  const bankAccount = randomUUID();
  await runAs(
    "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')",
    [user.familyId, user.userId],
  );
  await runAs(
    `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
    [connection, user.familyId, user.userId, randomUUID()],
  );
  await runAs(
    `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Conta','BRL','BANK',$5)`,
    [bankAccount, user.familyId, connection, randomUUID(), checking],
  );
  // Saída agendada (PENDING, status pending, valor negativo): vira sched:.
  const schedId = randomUUID();
  await runAs(
    `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,'2026-11-15','ENEL DISTRIBUICAO',-18000,'BRL','PENDING','synthetic',$6)`,
    [schedId, user.familyId, bankAccount, checking, randomUUID(), randomUUID()],
  );
  // Regra aprendida: categoria sugerida/confirmada do agendamento (a mesma
  // fonte da aba Movimentos, resolveCategory).
  await runAs(
    "INSERT INTO merchant_rules(id,household_id,match_text,category_name,note) VALUES($1,$2,'ENEL','Energia','')",
    [randomUUID(), user.familyId],
  );

  const report = await readProjection(db, user, { today: TODAY });
  const wire = toProjectionWire(report);
  const byKey = new Map(wire.flows.map((f) => [f.key, f]));

  // Nenhum label vazio em fluxo algum (invariante): nunca string vazia.
  for (const f of wire.flows) assert.ok(f.label.length > 0, `label vazio: ${f.key}`);
  // Saídas de despesa com fonte categorizável (item do plano e saída agendada)
  // têm categoria resolvida. Fatura de cartão (bill:) e excedente previsto
  // (cardplan:) são saídas por desenho SEM categoria própria (category null).
  for (const f of wire.flows)
    if (
      f.direction === "out" &&
      (f.key.startsWith("item:") || f.key.startsWith("sched:"))
    )
      assert.ok(f.category !== null, `out sem category: ${f.key}`);

  // item: -> label do item + nome da categoria.
  const itemFlow = wire.flows.find(
    (f) => f.key.startsWith("item:") && byKey.get(f.key)!.label === "Conta de luz",
  );
  assert.ok(itemFlow, "fluxo do item do plano");
  assert.equal(itemFlow!.label, "Conta de luz");
  assert.equal(itemFlow!.category, "Categoria nomes");

  // bill: -> 'Fatura <cartão>' e category null.
  const billFlow = wire.flows.find((f) => f.key.startsWith("bill:"));
  assert.ok(billFlow, "fluxo da fatura");
  assert.equal(billFlow!.label, "Fatura Cartão nomes");
  assert.equal(billFlow!.category, null);

  // sched: -> label = description, category = sugerida pela merchant_rule.
  const schedFlow = byKey.get(`sched:${schedId}`);
  assert.ok(schedFlow, "fluxo da saída agendada");
  assert.equal(schedFlow!.label, "ENEL DISTRIBUICAO");
  assert.equal(schedFlow!.category, "Energia");
});
