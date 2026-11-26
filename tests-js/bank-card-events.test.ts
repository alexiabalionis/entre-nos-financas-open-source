import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { GONE_REASON, CHANGED_REASON } from "../src/server/bank-card-events.ts";
import { bankEventsSetup as setup } from "./bank-events-helpers.ts";

// Fases 2 e 3 de docs/SPEC-FATOS-CARTAO.md: o banco vira evento sozinho e os
// leitores dão o mesmo número antes e depois (equivalência). A ordem segue a
// leitura real: análise, eventos, e a análise de novo na leitura seguinte.

test("compra de cartão vira evento automático com os mesmos números nos leitores", async () => {
  const db = await openDatabase();
  try {
    const { purchase, read, analyze, numbers, status } = await setup(db);
    const posted = await purchase("2026-10-25", -60000, "LOJA TESTE");
    const unposted = await purchase("2026-10-26", -15000, "MERCADO TESTE", "PENDING");
    const payment = await purchase("2026-10-27", 9900, "PAGAMENTO EFETUADO FATURA");

    await analyze();
    const before = await numbers();
    assert.equal(before.expense, "75000", "números reais, não zero");

    const result = await read();
    assert.equal(result.created, 2, "só as duas compras viram evento");
    const rows = await status();
    for (const id of [posted, unposted]) {
      assert.equal(rows.get(id)!.status, "recorded");
      assert.equal(rows.get(id)!.auto_recorded, true);
      assert.equal(rows.get(id)!.kind, "card_purchase");
      assert.ok(rows.get(id)!.category_id, "categoria de resolveCategory");
    }
    // Pagamento de fatura sem a outra ponta fica pendente e neutro.
    assert.equal(rows.get(payment)!.status, "pending");

    // Na leitura seguinte a análise roda de novo: a compra não pode coincidir
    // com o próprio evento e sair da fatura.
    await analyze();
    assert.deepEqual(await numbers(), before, "leitores iguais antes e depois");
    assert.equal((await read()).created, 0, "idempotente");
  } finally {
    await db.close();
  }
});

test("duas compras iguais no mesmo dia no mesmo cartão contam as duas", async () => {
  const db = await openDatabase();
  try {
    const { purchase, read, numbers } = await setup(db);
    await purchase("2026-10-25", -800, "CAFE A");
    await read();
    await purchase("2026-10-25", -800, "CAFE B");
    const second = await read();
    assert.equal(second.created, 1, "a segunda não é histórico da primeira");
    assert.equal((await numbers()).expense, "1600");
  } finally {
    await db.close();
  }
});

test("estorno vira refund ligado à compra e abate o mesmo valor de antes", async () => {
  const db = await openDatabase();
  try {
    const { purchase, read, analyze, numbers, status } = await setup(db);
    const buy = await purchase("2026-10-20", -10000, "LOJA ROUPAS CENTRO");
    await read();
    const refund = await purchase("2026-10-22", 4000, "ESTORNO LOJA ROUPAS CENTRO");
    const unknown = await purchase("2026-10-23", 1500, "CREDITO DIVERSO");
    await analyze();
    const before = await numbers();
    assert.equal(before.expense, "4500", "100 - 40 - 15 já abatia como pendente");

    const result = await read();
    assert.equal(result.refunds, 1);
    const rows = await status();
    assert.equal(rows.get(refund)!.kind, "refund");
    assert.equal(rows.get(refund)!.related_event_id, rows.get(buy)!.event_id);
    // Sem compra de origem identificável: fica pendente e continua abatendo.
    assert.equal(rows.get(unknown)!.status, "pending");

    await analyze();
    assert.deepEqual(await numbers(), before);
  } finally {
    await db.close();
  }
});

test("pagamento de fatura e transferência própria viram um evento neutro com as duas pontas", async () => {
  const db = await openDatabase();
  try {
    const { card, account, line, purchase, read, analyze, numbers, status, familyId } = await setup(db);
    const checking = await account("checking", "Corrente");
    const savings = await account("checking", "Poupança");
    await purchase("2026-10-05", -30000, "LOJA TESTE");
    const fromChecking = await line(checking, "2026-10-20", -30000, "DEBITO AUTOMATICO FATURA CARTAO");
    const onCard = await line(card, "2026-10-20", 30000, "PAGAMENTO RECEBIDO");
    const out = await line(checking, "2026-10-21", -50000, "PIX TRANSFERENCIA ENVIADA");
    const into = await line(savings, "2026-10-21", 50000, "PIX TRANSFERENCIA RECEBIDA");
    await analyze();
    const before = await numbers();

    const result = await read();
    assert.equal(result.pairs, 2);
    const rows = await status();
    assert.equal(rows.get(fromChecking)!.kind, "card_payment");
    assert.equal(rows.get(fromChecking)!.event_id, rows.get(onCard)!.event_id);
    assert.equal(rows.get(out)!.kind, "transfer");
    assert.equal(rows.get(out)!.event_id, rows.get(into)!.event_id);

    // Uma só vez no razão, de conta para conta, sem gasto.
    const legs = (
      await db.query<{ account_id: string; amount_cents: string }>(
        "SELECT account_id,amount_cents::text FROM ledger_entries WHERE event_id=$1 ORDER BY amount_cents",
        [rows.get(fromChecking)!.event_id],
      )
    ).rows;
    assert.deepEqual(legs, [
      { account_id: checking.local, amount_cents: "-30000" },
      { account_id: card.local, amount_cents: "30000" },
    ]);
    await analyze();
    assert.deepEqual(await numbers(), before, "gasto e fatura iguais");
    void familyId;
  } finally {
    await db.close();
  }
});

test("evento automático acompanha o banco, cancela quando some e quando muda de sinal", async () => {
  const db = await openDatabase();
  try {
    const { card, purchase, read, numbers, status } = await setup(db);
    const id = await purchase("2026-10-26", -15000, "MERCADO TESTE", "PENDING");
    await read();
    const eventId = (await status()).get(id)!.event_id!;

    // O banco muda o valor e a data (o espelho já segue em storeObservations).
    await db.query(
      "UPDATE bank_transactions SET amount_cents=-17500,transaction_date='2026-10-27' WHERE id=$1",
      [id],
    );
    assert.equal((await read()).updated, 1);
    const event = (
      await db.query<{ amount_cents: string; transaction_date: string }>(
        "SELECT amount_cents::text,transaction_date::text FROM economic_events WHERE id=$1",
        [eventId],
      )
    ).rows[0];
    assert.deepEqual(event, { amount_cents: "-17500", transaction_date: "2026-10-27" });
    const legs = (
      await db.query<{ account_id: string | null; amount_cents: string }>(
        "SELECT account_id,amount_cents::text FROM ledger_entries WHERE event_id=$1 ORDER BY amount_cents",
        [eventId],
      )
    ).rows;
    assert.deepEqual(legs, [
      { account_id: card.local, amount_cents: "-17500" },
      { account_id: null, amount_cents: "17500" },
    ]);

    // Some do banco: cancelado e fora do gasto, sem apagar. Volta: desfeito.
    await db.query("UPDATE bank_transactions SET missing=true WHERE id=$1", [id]);
    assert.equal((await read()).cancelled, 1);
    const reason = async () =>
      (await db.query<{ cancel_reason: string | null }>("SELECT cancel_reason FROM economic_events WHERE id=$1", [eventId]))
        .rows[0].cancel_reason;
    assert.equal(await reason(), GONE_REASON);
    assert.equal((await numbers()).expense, "0");
    await db.query("UPDATE bank_transactions SET missing=false WHERE id=$1", [id]);
    assert.equal((await read()).restored, 1);
    assert.equal((await numbers()).expense, "17500");

    // Muda de sinal: o evento não pode virar compra positiva; é cancelado.
    await db.query("UPDATE bank_transactions SET amount_cents=17500 WHERE id=$1", [id]);
    await read();
    assert.equal(await reason(), CHANGED_REASON);
  } finally {
    await db.close();
  }
});
