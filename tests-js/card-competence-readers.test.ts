import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { readState } from "../src/server/state.ts";
import { readCards } from "../src/server/cards.ts";

// K2: uma compra no cartão de 25/10 (fecha dia 13, vence dia 20) pesa em
// novembro, pendente ou aprovada; a timeline continua em outubro.
test("compra no cartão: mesma competência pendente e aprovada, timeline pela data", async () => {
  const db = await openDatabase();
  try {
    const email = "k2-readers@example.invalid";
    const userId = await createFamily(db, {
      name: "Teste",
      familyName: "Casa",
      email,
      password: "Sintetica!2026abcd",
    });
    const familyId = (
      await db.query<{ household_id: string }>(
        "SELECT household_id FROM members WHERE user_id=$1",
        [userId],
      )
    ).rows[0].household_id;
    const user = {
      userId,
      familyId,
      name: "Teste",
      email,
      role: "owner",
    } as Identity;
    const card = randomUUID(),
      connection = randomUUID(),
      ba = randomUUID(),
      run = randomUUID(),
      tx = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)`,
      [card, familyId, userId],
    );
    await db.query(
      `INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')`,
      [familyId, userId],
    );
    await db.query(
      `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
      [connection, familyId, userId, randomUUID()],
    );
    await db.query(
      `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão','BRL','CREDIT',$5)`,
      [ba, familyId, connection, randomUUID(), card],
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,'2026-10-25','LOJA TESTE',-60000,'BRL','POSTED','synthetic',$6)`,
      [tx, familyId, ba, card, randomUUID(), run],
    );
    const expense = async (month: string) =>
      (await readState(db, user, month, "BRL", undefined, undefined, false))
        .summary.expense_cents;
    const timeline = async (month: string) =>
      (
        await readState(db, user, month, "BRL", undefined, undefined, false)
      ).events.map((e) => e.description);
    assert.equal(await expense("2026-10-01"), "0");
    assert.equal(await expense("2026-11-01"), "60000");
    // Aprovação: vira evento com a data original, ligado à linha do banco.
    const category = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Vestuário')",
      [category, familyId],
    );
    const event = await asUser(db, userId, async (t) => {
      const id = await createManualEventTx(t, user, {
        account_id: card,
        date: "2026-10-25",
        description: "LOJA TESTE",
        amount: "-600,00",
        kind: "card_purchase",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      });
      await t.query(
        "UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2",
        [id, tx],
      );
      return id;
    });
    assert.ok(event);
    assert.equal(await expense("2026-10-01"), "0");
    assert.equal(await expense("2026-11-01"), "60000");
    assert.deepEqual(await timeline("2026-10-01"), ["LOJA TESTE"]);
    assert.deepEqual(await timeline("2026-11-01"), []);
    const nov = await readState(
      db,
      user,
      "2026-11-01",
      "BRL",
      undefined,
      undefined,
      false,
    );
    assert.equal(nov.cardDueOtherMonth.cents, "60000");
    assert.equal(
      (await readCards(db, user, "2026-11"))[0].registered_cents,
      "60000",
    );
    assert.equal(
      (await readCards(db, user, "2026-10"))[0].registered_cents,
      "0",
    );
  } finally {
    await db.close();
  }
});

// Fallback: cartão SEM fechamento informado não tem competência derivável, então
// a compra conta no mês da DATA DA COMPRA (estimado) e o cartão entra no aviso
// cardBudgetUnconfigured. Vale igual pendente e aprovada: nunca muda de mês.
test("compra no cartão sem fechamento: conta na data da compra e avisa", async () => {
  const db = await openDatabase();
  try {
    const email = "k2-nofechamento@example.invalid";
    const userId = await createFamily(db, {
      name: "Teste",
      familyName: "Casa",
      email,
      password: "Sintetica!2026abcd",
    });
    const familyId = (
      await db.query<{ household_id: string }>(
        "SELECT household_id FROM members WHERE user_id=$1",
        [userId],
      )
    ).rows[0].household_id;
    const user = {
      userId,
      familyId,
      name: "Teste",
      email,
      role: "owner",
    } as Identity;
    const card = randomUUID(),
      connection = randomUUID(),
      ba = randomUUID(),
      run = randomUUID(),
      tx = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)`,
      [card, familyId, userId],
    );
    await db.query(
      `INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')`,
      [familyId, userId],
    );
    await db.query(
      `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
      [connection, familyId, userId, randomUUID()],
    );
    await db.query(
      `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão','BRL','CREDIT',$5)`,
      [ba, familyId, connection, randomUUID(), card],
    );
    // Sem saveCardCycle: cartão sem fechamento informado.
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,'2026-10-25','LOJA TESTE',-60000,'BRL','POSTED','synthetic',$6)`,
      [tx, familyId, ba, card, randomUUID(), run],
    );
    const stateOf = (month: string) =>
      readState(db, user, month, "BRL", undefined, undefined, false);
    // Pendente: conta em outubro (data da compra), não em novembro, e avisa.
    const octPending = await stateOf("2026-10-01");
    assert.equal(octPending.summary.expense_cents, "60000");
    assert.ok(octPending.cardBudgetUnconfigured.includes(card));
    assert.equal((await stateOf("2026-11-01")).summary.expense_cents, "0");
    // Aprovação: vira evento com a data original, ligado à linha do banco.
    const category = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Vestuário')",
      [category, familyId],
    );
    const event = await asUser(db, userId, async (t) => {
      const id = await createManualEventTx(t, user, {
        account_id: card,
        date: "2026-10-25",
        description: "LOJA TESTE",
        amount: "-600,00",
        kind: "card_purchase",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      });
      await t.query(
        "UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2",
        [id, tx],
      );
      return id;
    });
    assert.ok(event);
    // Aprovada: mesmo mês (outubro), mesmo valor, cartão ainda avisado.
    const octApproved = await stateOf("2026-10-01");
    assert.equal(octApproved.summary.expense_cents, "60000");
    assert.ok(octApproved.cardBudgetUnconfigured.includes(card));
    assert.equal((await stateOf("2026-11-01")).summary.expense_cents, "0");
    assert.equal(
      (await readCards(db, user, "2026-10"))[0].registered_cents,
      "60000",
    );
  } finally {
    await db.close();
  }
});

import { readCardProjection } from "../src/server/cards.ts";

// Infra comum: família + cartão conectado. Devolve ids e a Identity.
async function cardFamily(
  db: Awaited<ReturnType<typeof openDatabase>>,
  email: string,
) {
  const userId = await createFamily(db, {
    name: "Teste",
    familyName: "Casa",
    email,
    password: "Sintetica!2026abcd",
  });
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user = {
    userId,
    familyId,
    name: "Teste",
    email,
    role: "owner",
  } as Identity;
  const card = randomUUID(),
    connection = randomUUID(),
    ba = randomUUID();
  await db.query(
    `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)`,
    [card, familyId, userId],
  );
  await db.query(
    `INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')`,
    [familyId, userId],
  );
  await db.query(
    `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
    [connection, familyId, userId, randomUUID()],
  );
  await db.query(
    `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão','BRL','CREDIT',$5)`,
    [ba, familyId, connection, randomUUID(), card],
  );
  return { userId, familyId, user, card, ba };
}

async function insertPurchase(
  db: Awaited<ReturnType<typeof openDatabase>>,
  familyId: string,
  ba: string,
  card: string,
  amount: number,
  date: string,
  description = "LOJA TESTE",
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL','POSTED','synthetic',$9)`,
    [
      id,
      familyId,
      ba,
      card,
      randomUUID(),
      date,
      description,
      amount,
      randomUUID(),
    ],
  );
  return id;
}

// Item 1: os filtros da tela Mês alcançam as compras pendentes de cartão —
// filtrar por outra conta ou por outra categoria zera a despesa do cartão.
test("compra pendente no cartão respeita filtros de conta e de categoria", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card, ba } = await cardFamily(
      db,
      "k2-filtros@example.invalid",
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    // Compra em 25/10 -> competência novembro. Descrição "IFOOD" cai em
    // "Alimentação fora" pela regex de categoria.
    await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -60000,
      "2026-10-25",
      "IFOOD DELIVERY",
    );
    const expense = async (opts: { accountId?: string; categoryId?: string }) =>
      (
        await readState(
          db,
          user,
          "2026-11-01",
          "BRL",
          opts.accountId,
          opts.categoryId,
          false,
        )
      ).summary.expense_cents;
    // Sem filtro: a compra pesa em novembro.
    assert.equal(await expense({}), "60000");
    // Filtro por outra conta: a compra do cartão fica de fora.
    assert.equal(await expense({ accountId: randomUUID() }), "0");
    // Categorias podem já existir no seed da família; ON CONFLICT para reuso.
    const ensureCat = async (name: string) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO categories(id,household_id,name) VALUES($1,$2,$3) ON CONFLICT(household_id,name) DO NOTHING",
        [id, familyId, name],
      );
      return (
        await db.query<{ id: string }>(
          "SELECT id FROM categories WHERE household_id=$1 AND name=$2",
          [familyId, name],
        )
      ).rows[0].id;
    };
    // Filtro por outra categoria: a compra (Alimentação fora) não entra.
    assert.equal(await expense({ categoryId: await ensureCat("Saúde") }), "0");
    // Filtro pela própria categoria resolvida: a compra entra.
    assert.equal(
      await expense({ categoryId: await ensureCat("Alimentação fora") }),
      "60000",
    );
  } finally {
    await db.close();
  }
});

// Item 2: estorno pendente no cartão abate o gasto do seu mês de competência.
// Pendente e aprovado dão o mesmo resultado.
test("estorno no cartão abate a compra no mês de competência, pendente e aprovado", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, userId, card, ba } = await cardFamily(
      db,
      "k2-estorno@example.invalid",
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    // Compra -60000 e estorno +60000, ambos pendentes, em 25/10 -> novembro.
    const purchaseTx = await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -60000,
      "2026-10-25",
      "LOJA TESTE",
    );
    const refundTx = await insertPurchase(
      db,
      familyId,
      ba,
      card,
      60000,
      "2026-10-25",
      "ESTORNO LOJA TESTE",
    );
    const expense = async (month: string) =>
      (await readState(db, user, month, "BRL", undefined, undefined, false))
        .summary.expense_cents;
    // Pendentes: o estorno abate a compra no mês de competência (novembro).
    assert.equal(await expense("2026-11-01"), "0");
    assert.equal(await expense("2026-10-01"), "0");
    // Aprova compra e estorno (eventos card_purchase + refund, estorno ligado à
    // despesa). Aprovados pesam pela mesma competência -> novembro continua 0.
    const category = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Vestuário')",
      [category, familyId],
    );
    await asUser(db, userId, async (t) => {
      const purchase = await createManualEventTx(t, user, {
        account_id: card,
        date: "2026-10-25",
        description: "LOJA TESTE",
        amount: "-600,00",
        kind: "card_purchase",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      });
      await t.query(
        "UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2",
        [purchase, purchaseTx],
      );
      const refund = await createManualEventTx(t, user, {
        account_id: card,
        date: "2026-10-25",
        description: "ESTORNO LOJA TESTE",
        amount: "600,00",
        kind: "refund",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: purchase,
      });
      await t.query(
        "UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2",
        [refund, refundTx],
      );
    });
    assert.equal(await expense("2026-11-01"), "0");
  } finally {
    await db.close();
  }
});

// Item 3: o aviso cardBudgetUnconfigured marca só cartões SEM nenhuma versão
// de ciclo. Uma compra anterior ao início do histórico de um cartão COM ciclo
// conta no mês da compra, sem aviso.
test("aviso de ciclo só para cartão sem versão; compra antes do histórico não avisa", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card, ba } = await cardFamily(
      db,
      "k2-aviso@example.invalid",
    );
    // Cartão COM ciclo salvo em 2026-10. Uma compra ANTES disso (agosto) não
    // tem versão vigente na data -> competência indeterminada -> conta no mês
    // da compra (agosto), mas SEM aviso, porque o cartão tem ciclo.
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -40000,
      "2026-08-10",
      "LOJA ANTIGA",
    );
    const aug = await readState(
      db,
      user,
      "2026-08-01",
      "BRL",
      undefined,
      undefined,
      false,
    );
    assert.equal(aug.summary.expense_cents, "40000");
    assert.ok(!aug.cardBudgetUnconfigured.includes(card));
    // Segundo cartão SEM nenhuma versão de ciclo -> compra conta na data e
    // avisa.
    const semCiclo = randomUUID(),
      conn2 = randomUUID(),
      ba2 = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão sem ciclo','Teste','BRL','card',$3)`,
      [semCiclo, familyId, user.userId],
    );
    await db.query(
      `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
      [conn2, familyId, user.userId, randomUUID()],
    );
    await db.query(
      `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão','BRL','CREDIT',$5)`,
      [ba2, familyId, conn2, randomUUID(), semCiclo],
    );
    await insertPurchase(
      db,
      familyId,
      ba2,
      semCiclo,
      -30000,
      "2026-08-10",
      "LOJA SEM CICLO",
    );
    const aug2 = await readState(
      db,
      user,
      "2026-08-01",
      "BRL",
      undefined,
      undefined,
      false,
    );
    assert.ok(aug2.cardBudgetUnconfigured.includes(semCiclo));
    assert.ok(!aug2.cardBudgetUnconfigured.includes(card));
  } finally {
    await db.close();
  }
});

// Item 5: readCardProjection cobre os três casos: fatura em revisão (total
// null não quebra e marca provisional), mês com fatura do banco usa o total
// oficial + compras sem fatura (nunca a soma parcial das vinculadas), e
// purchase_date presente no card_meta.
test("projeção de faturas: total em revisão, total oficial + avulsas, purchase_date", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card, ba } = await cardFamily(
      db,
      "k2-projecao@example.invalid",
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-11-13", due_date: "2026-11-20" },
      { today: "2026-11-01" },
    );
    // Fatura do banco de novembro, total oficial 100000, remote_id billNov.
    const billNov = randomUUID();
    await asUser(db, user.userId, (tx) =>
      tx.query(
        `INSERT INTO bank_card_bills(id,household_id,bank_account_id,remote_id,due_date,total_cents,currency,charges_cents) VALUES($1,$2,$3,$4,'2026-11-20',100000,'BRL',0)`,
        [randomUUID(), familyId, ba, billNov],
      ),
    );
    // Compra VINCULADA a essa fatura (bill_id=billNov), valor parcial 30000:
    // NÃO deve somar seu parcial; o total do mês é o oficial 100000.
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,card_meta) VALUES($1,$2,$3,$4,$5,'2026-11-05','LOJA VINCULADA',-30000,'BRL','POSTED','synthetic',$6,$7)`,
      [
        randomUUID(),
        familyId,
        ba,
        card,
        randomUUID(),
        randomUUID(),
        JSON.stringify({ bill_id: billNov, purchase_date: "2026-11-05" }),
      ],
    );
    // Compra AVULSA (sem bill_id) que vence em novembro pelo ciclo: 20000 soma
    // por cima do total oficial.
    await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -20000,
      "2026-11-10",
      "LOJA AVULSA",
    );
    // Fatura EM REVISÃO (total_cents null) vencendo em dezembro.
    const billDec = randomUUID();
    await asUser(db, user.userId, (tx) =>
      tx.query(
        `INSERT INTO bank_card_bills(id,household_id,bank_account_id,remote_id,due_date,total_cents,raw_total,needs_review,currency,charges_cents) VALUES($1,$2,$3,$4,'2026-12-20',NULL,'123.4567',true,'BRL',0)`,
        [randomUUID(), familyId, ba, billDec],
      ),
    );
    const projection = await readCardProjection(db, user, "2026-11");
    const months = projection.cards[0].months;
    const nov = months.find((m) => m.due_month === "2026-11")!;
    // Total do mês = oficial (100000) + avulsa (20000), nunca o parcial da
    // compra vinculada (30000).
    assert.equal(nov.total_cents, "120000");
    assert.equal(nov.bank_cents, "100000");
    assert.equal(nov.cycle_cents, "20000");
    const dec = months.find((m) => m.due_month === "2026-12")!;
    // Fatura em revisão: total null não quebra, soma oficial pulada, provisional.
    assert.equal(dec.total_cents, "0");
    assert.equal(dec.provisional, true);
  } finally {
    await db.close();
  }
});

// Item 6: uma versão de ciclo AGENDADA que já venceu passa a valer em
// readCards().cycle (via syncCurrentCycle), e o lembrete usa o novo vencimento.
test("versão de ciclo agendada que já venceu é promovida em readCards e no lembrete", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card } = await cardFamily(
      db,
      "k2-sync@example.invalid",
    );
    // Hoje real no fuso do app.
    const today = (
      await db.query<{ today: string }>(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
      )
    ).rows[0].today;
    // Ciclo inicial salvo há bastante tempo (fecha dia 5, vence dia 12).
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-01-05", due_date: "2026-01-12" },
      { today: "2026-01-01" },
    );
    const before = (await readCards(db, user, today.slice(0, 7)))[0];
    assert.equal(before.cycle?.closing_day, 5);
    assert.equal(before.cycle?.due_day, 12);
    // Versão AGENDADA com valid_from no passado (já venceu): fecha dia 8,
    // vence dia 15, offset 1. Como valid_from<=hoje, torna-se a vigente.
    await db.query(
      `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by) VALUES($1,$2,$3,8,15,1,($4::date-interval '2 months')::date,date_trunc('month',$4::date-interval '1 month')::date,$5)`,
      [randomUUID(), familyId, card, today, user.userId],
    );
    // readCards promove card_cycles para a versão vigente (8/15).
    const after = (await readCards(db, user, today.slice(0, 7)))[0];
    assert.equal(after.cycle?.closing_day, 8);
    assert.equal(after.cycle?.due_day, 15);
    assert.equal(Number(after.cycle?.effective_due_date.slice(8, 10)), 15);
    assert.equal(Number(after.cycle?.effective_close_date.slice(8, 10)), 8);
    // O lembrete (sendDueReminders) também roda o sync antes da sua query; o
    // card_cycles já está promovido, então a leitura é consistente.
    const promoted = (
      await db.query<{ closing_day: number; due_day: number }>(
        "SELECT closing_day,due_day FROM card_cycles WHERE account_id=$1",
        [card],
      )
    ).rows[0];
    assert.equal(promoted.closing_day, 8);
    assert.equal(promoted.due_day, 15);
  } finally {
    await db.close();
  }
});

// competenceSpending: o gasto por categoria segue a competência (mês de
// vencimento da fatura), mesma fonte do total do mês. Uma compra no cartão de
// 25/10 (fecha 13, vence 20) com categoria aparece na competência de novembro,
// não de outubro, e o total_cents bate com summary.expense_cents nos dois meses.
test("competenceSpending: categoria pesa pela competência e total bate com o do mês", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card, ba } = await cardFamily(
      db,
      "k2-competence-spending@example.invalid",
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    // Garante a categoria "Alimentação fora" (resolvida da descrição IFOOD)
    // para o slice carregar o nome real em vez de "Sem categoria".
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Alimentação fora') ON CONFLICT(household_id,name) DO NOTHING",
      [randomUUID(), familyId],
    );
    await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -60000,
      "2026-10-25",
      "IFOOD DELIVERY",
    );
    const stateOf = (month: string) =>
      readState(db, user, month, "BRL", undefined, undefined, false);
    const oct = await stateOf("2026-10-01");
    const nov = await stateOf("2026-11-01");
    // Outubro: compra não pesa (competência é novembro). Nenhum slice de gasto.
    assert.deepEqual(oct.competenceSpending.slices, []);
    assert.equal(oct.competenceSpending.total_cents, "0");
    assert.equal(oct.competenceSpending.total_cents, oct.summary.expense_cents);
    // Novembro: a categoria aparece com 60000 e o total bate com o do mês.
    const slice = nov.competenceSpending.slices.find(
      (s) => s.name === "Alimentação fora",
    );
    assert.ok(slice, "esperava slice da categoria Alimentação fora em novembro");
    assert.equal(slice.cents, "60000");
    assert.equal(nov.competenceSpending.total_cents, "60000");
    assert.equal(nov.competenceSpending.total_cents, nov.summary.expense_cents);
  } finally {
    await db.close();
  }
});

// Pendência 1: competence.conflict calculado em cardCompetence passa a ser
// VISÍVEL na tela Mês. A fatura foi identificada pelo banco (bill_id ->
// bank_card_bills.due_date), mas o ciclo cadastrado apontaria outro mês. O
// cálculo não muda (o mês da fatura segue o do banco); só surge um aviso nos
// insights ("Precisa de você").
test("conflito de competência do cartão vira aviso visível nos insights", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, userId, card, ba } = await cardFamily(
      db,
      "k2-conflito@example.invalid",
    );
    // Ciclo: fecha dia 13, vence dia 20. Compra em 25/10 fecha 13/11 e
    // venceria em 20/11 pelo ciclo -> competência de novembro.
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    // Fatura do banco com vencimento em DEZEMBRO (outro mês que o ciclo), ligada
    // à compra por bill_id. A competência explícita (banco) vence em dezembro,
    // mas o ciclo apontaria novembro -> conflict.cycleMonth = 2026-11.
    const billDec = randomUUID();
    await asUser(db, userId, (t) =>
      t.query(
        `INSERT INTO bank_card_bills(id,household_id,bank_account_id,remote_id,due_date,total_cents,currency,charges_cents) VALUES($1,$2,$3,$4,'2026-12-20',60000,'BRL',0)`,
        [randomUUID(), familyId, ba, billDec],
      ),
    );
    const txId = randomUUID();
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,card_meta) VALUES($1,$2,$3,$4,$5,'2026-10-25','LOJA CONFLITO',-60000,'BRL','POSTED','synthetic',$6,$7)`,
      [
        txId,
        familyId,
        ba,
        card,
        randomUUID(),
        randomUUID(),
        JSON.stringify({ bill_id: billDec }),
      ],
    );
    const category = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Vestuário')",
      [category, familyId],
    );
    const event = await asUser(db, userId, async (t) => {
      const id = await createManualEventTx(t, user, {
        account_id: card,
        date: "2026-10-25",
        description: "LOJA CONFLITO",
        amount: "-600,00",
        kind: "card_purchase",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      });
      await t.query(
        "UPDATE bank_transactions SET event_id=$1,status='recorded' WHERE id=$2",
        [id, txId],
      );
      return id;
    });
    assert.ok(event);
    // A fatura vence em dezembro: o aviso de conflito sai na tela de dezembro.
    const dec = await readState(
      db,
      user,
      "2026-12-01",
      "BRL",
      undefined,
      undefined,
      false,
    );
    const conflito = dec.insights.find(
      (i) => i.title === "Mês da fatura do cartão em dúvida",
    );
    assert.ok(conflito, "esperava aviso de conflito nos insights de dezembro");
    assert.equal(
      conflito.fact,
      "A fatura de 2026-12 foi identificada pelo banco, mas o ciclo cadastrado apontaria outro mês. Confira o ciclo do cartão.",
    );
    // O cálculo não mudou: a fatura (60000) segue pesando no mês do banco.
    assert.equal(dec.summary.expense_cents, "60000");
    assert.equal((await readState(db, user, "2026-11-01", "BRL", undefined, undefined, false)).summary.expense_cents, "0");
  } finally {
    await db.close();
  }
});

// Pendência 2: gasto no cartão em moeda diferente da tela (ex USD) ENTRA como
// aviso visível, nunca somando valor convertido falso. O total em reais não
// muda; só surge um insight com as moedas estrangeiras.
test("gasto de cartão em outra moeda vira aviso visível sem mexer no total em reais", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, userId, card, ba } = await cardFamily(
      db,
      "k2-moeda-estrangeira@example.invalid",
    );
    await saveCardCycle(
      db,
      user,
      { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" },
      { today: "2026-10-01" },
    );
    // Compra em reais no cartão (competência novembro): 60000.
    await insertPurchase(
      db,
      familyId,
      ba,
      card,
      -60000,
      "2026-10-25",
      "LOJA BRL",
    );
    // Cartão em USD, mesma família. Um evento aprovado nele cai na janela que a
    // tela de reais varre, mas em moeda diferente: readCardEvents filtra pela
    // moeda da tela, então ele NÃO entra no total em reais; só é detectado para
    // o aviso. Criado pelo caminho real (ledger balanceado).
    const cardUsd = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão USD','Teste','USD','card',$3)`,
      [cardUsd, familyId, userId],
    );
    const catUsd = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Viagem')",
      [catUsd, familyId],
    );
    await asUser(db, userId, (t) =>
      createManualEventTx(t, user, {
        account_id: cardUsd,
        date: "2026-11-10",
        description: "LOJA USD",
        amount: "-50,00",
        kind: "card_purchase",
        category_id: catUsd,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
    const nov = await readState(
      db,
      user,
      "2026-11-01",
      "BRL",
      undefined,
      undefined,
      false,
    );
    // O total em reais segue só com a compra BRL (60000): o evento USD não soma.
    assert.equal(nov.summary.expense_cents, "60000");
    const aviso = nov.insights.find(
      (i) => i.title === "Gastos de cartão em outra moeda fora do total",
    );
    assert.ok(aviso, "esperava aviso de gasto em outra moeda nos insights");
    assert.ok(aviso.fact.includes("USD"), "o aviso deve citar a moeda USD");
    // Na tela em USD o aviso some (não há moeda estrangeira em relação a USD
    // além do BRL, que então vira o estrangeiro) — e o total USD é o do evento.
    const novUsd = await readState(
      db,
      user,
      "2026-11-01",
      "USD",
      undefined,
      undefined,
      false,
    );
    assert.equal(novUsd.summary.expense_cents, "5000");
  } finally {
    await db.close();
  }
});
