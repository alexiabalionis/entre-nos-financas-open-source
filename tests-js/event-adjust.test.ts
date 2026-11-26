import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { cancelEvent, restoreEvent, USER_CANCEL_REASON } from "../src/server/event-cancel.ts";
import { changeEventKind } from "../src/server/event-kind.ts";
import { bankEventsSetup } from "./bank-events-helpers.ts";

// Fase 4 de docs/SPEC-FATOS-CARTAO.md: a pessoa cancela, restaura e corrige o
// tipo do que o app decidiu. Nenhuma correção muda o saldo de uma conta, e
// desfazer um par nunca esconde a outra ponta.

test("cancelar tira do gasto sem apagar; restaurar devolve; a leitura não desfaz", async () => {
  const db = await openDatabase();
  try {
    const { user, purchase, read, numbers, status } = await bankEventsSetup(db);
    const id = await purchase("2026-10-25", -60000, "LOJA TESTE");
    await read();
    const event = (await status()).get(id)!.event_id!;

    await cancelEvent(db, user, { event_id: event });
    assert.equal((await numbers()).expense, "0");
    const row = (
      await db.query<{ cancel_reason: string }>("SELECT cancel_reason FROM economic_events WHERE id=$1", [event])
    ).rows[0];
    assert.equal(row.cancel_reason, USER_CANCEL_REASON);
    await read();
    assert.equal((await numbers()).expense, "0", "a leitura seguinte respeita o cancelamento");
    await assert.rejects(cancelEvent(db, user, { event_id: event }));

    await restoreEvent(db, user, { event_id: event });
    assert.equal((await numbers()).expense, "60000");
  } finally {
    await db.close();
  }
});

test("gasto da conta removido sai do total do Mês e chega à tela marcado", async () => {
  const db = await openDatabase();
  try {
    const { user, account, line, read, numbers, status } = await bankEventsSetup(db);
    const checking = await account("checking", "Corrente");
    const id = await line(checking, "2026-10-10", -12000, "FARMACIA CENTRO");
    // Conta corrente ainda não vira evento sozinha (só cartão e pares): cria
    // como o "Registrar" faria e liga a linha automática, como na fase 2.
    const { createManualEvent } = await import("../src/server/manual.ts");
    const category = (
      await db.query<{ id: string }>("INSERT INTO categories(id,household_id,name) VALUES(gen_random_uuid(),$1,'Teste farmácia') RETURNING id", [
        user.familyId,
      ])
    ).rows[0].id;
    const event = await createManualEvent(db, user, {
      account_id: checking.local,
      date: "2026-10-10",
      description: "FARMACIA CENTRO",
      amount: "-120,00",
      kind: "expense",
      category_id: category,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    });
    await db.query("UPDATE bank_transactions SET status='recorded',event_id=$1,auto_recorded=true WHERE id=$2", [event, id]);
    assert.equal((await numbers()).october.expense, "12000");

    await cancelEvent(db, user, { event_id: event, reason: "Comprado para a vizinha" });
    assert.equal((await numbers()).october.expense, "0", "fora do total");
    const { readState } = await import("../src/server/state.ts");
    const { movementRows } = await import("../src/domain/movements.ts");
    const row = () =>
      readState(db, user, "2026-10-01", "BRL", undefined, undefined, false).then(
        (s) => movementRows(s).find((r) => r.id === "event:" + event)!,
      );
    const removed = await row();
    assert.equal(removed.removed, "person", "continua na lista, marcado");
    assert.equal(removed.auto, true);
    assert.equal(removed.accountId, checking.local);

    // O banco deixa de trazer: a marca vira "bank" e voltar a contar é recusado.
    await db.query("UPDATE bank_transactions SET missing=true WHERE id=$1", [id]);
    await read();
    assert.equal((await row()).removed, "bank");
    void status;
  } finally {
    await db.close();
  }
});

test("restaurar é recusado enquanto o banco não traz o movimento", async () => {
  const db = await openDatabase();
  try {
    const { user, purchase, read, status } = await bankEventsSetup(db);
    const id = await purchase("2026-10-25", -60000, "LOJA TESTE");
    await read();
    await db.query("UPDATE bank_transactions SET missing=true WHERE id=$1", [id]);
    await read();
    await assert.rejects(restoreEvent(db, user, { event_id: (await status()).get(id)!.event_id! }), /não traz mais/);
  } finally {
    await db.close();
  }
});

test("transferência que não era: cada ponta vira o seu evento e o saldo das contas não muda", async () => {
  const db = await openDatabase();
  try {
    const { user, account, line, read, numbers, balances, status } = await bankEventsSetup(db);
    const checking = await account("checking", "Corrente");
    const savings = await account("checking", "Poupança");
    const out = await line(checking, "2026-10-21", -50000, "PIX TRANSFERENCIA ENVIADA");
    const into = await line(savings, "2026-10-21", 50000, "PIX TRANSFERENCIA RECEBIDA");
    await read();
    const pair = (await status()).get(out)!.event_id!;
    const before = await balances();

    await changeEventKind(db, user, { event_id: pair, kind: "expense", category_name: "Presentes" });
    const rows = await status();
    assert.equal(rows.get(out)!.kind, "expense");
    assert.equal(rows.get(into)!.kind, "income", "a outra ponta não some");
    assert.notEqual(rows.get(into)!.event_id, pair);
    assert.deepEqual(await balances(), before, "saldo de cada conta igual");
    const october = (await numbers()).october;
    assert.deepEqual(october, { income: "50000", expense: "50000" });
  } finally {
    await db.close();
  }
});

test("despesa que era pagamento de fatura: liga a outra ponta e sai do gasto", async () => {
  const db = await openDatabase();
  try {
    const { user, card, account, line, read, numbers, balances, status } = await bankEventsSetup(db);
    const checking = await account("checking", "Corrente");
    await read();
    // Sem texto reconhecido e com duas candidatas no cartão: o app não pareia.
    const out = await line(checking, "2026-10-20", -30000, "BOLETO 123");
    const onCard = await line(card, "2026-10-20", 30000, "CREDITO 456");
    const { createManualEvent } = await import("../src/server/manual.ts");
    const category = (
      await db.query<{ id: string }>("INSERT INTO categories(id,household_id,name) VALUES(gen_random_uuid(),$1,'Contas') RETURNING id", [
        user.familyId,
      ])
    ).rows[0].id;
    const event = await createManualEvent(db, user, {
      account_id: checking.local,
      date: "2026-10-20",
      description: "BOLETO 123",
      amount: "-300,00",
      kind: "expense",
      category_id: category,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    });
    await db.query("UPDATE bank_transactions SET status='recorded',event_id=$1 WHERE id=$2", [event, out]);
    const before = await balances();

    await assert.rejects(
      changeEventKind(db, user, { event_id: event, kind: "card_payment" }),
      /outra conta/,
    );
    await changeEventKind(db, user, {
      event_id: event,
      kind: "card_payment",
      counter_account_id: card.local,
      counter_bank_transaction_id: onCard,
    });
    const rows = await status();
    assert.equal(rows.get(out)!.kind, "card_payment");
    assert.equal(rows.get(onCard)!.event_id, event);
    assert.equal((await numbers()).october.expense, "0");
    const after = await balances();
    assert.equal(after[checking.local], before[checking.local], "corrente igual");
    assert.equal(after[card.local], "30000", "o pagamento entra no cartão");
  } finally {
    await db.close();
  }
});

test("estorno: troca de tipo recusa sinal errado e compra de origem inválida", async () => {
  const db = await openDatabase();
  try {
    const { user, purchase, read, numbers, balances, status } = await bankEventsSetup(db);
    const buy = await purchase("2026-10-20", -10000, "LOJA A");
    const credit = await purchase("2026-10-22", 4000, "CREDITO 789");
    await read();
    const rows = await status();
    assert.equal(rows.get(credit)!.status, "pending", "sem origem identificável");
    const buyEvent = rows.get(buy)!.event_id!;

    // Estorno não pode ter a compra mudada para um tipo sem gasto.
    const { createManualEvent } = await import("../src/server/manual.ts");
    const refund = await createManualEvent(db, user, {
      account_id: (await db.query<{ account_id: string }>("SELECT account_id FROM economic_events WHERE id=$1", [buyEvent])).rows[0].account_id,
      date: "2026-10-22",
      description: "CREDITO 789",
      amount: "40,00",
      kind: "refund",
      category_id: null,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: buyEvent,
    });
    await db.query("UPDATE bank_transactions SET status='recorded',event_id=$1 WHERE id=$2", [refund, credit]);
    const before = await balances();
    await assert.rejects(changeEventKind(db, user, { event_id: refund, kind: "card_purchase" }), /sinal/);
    await assert.rejects(
      changeEventKind(db, user, { event_id: refund, kind: "refund", related_event_id: refund }),
      /mesma moeda/,
    );
    // Uma compra com estorno ligado não pode deixar de ser gasto.
    await assert.rejects(changeEventKind(db, user, { event_id: buyEvent, kind: "refund", related_event_id: refund }), /estorno ligado/);
    assert.deepEqual(await balances(), before);
    assert.equal((await numbers()).expense, "6000");
  } finally {
    await db.close();
  }
});
