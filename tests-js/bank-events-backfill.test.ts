import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, asUser } from "../src/server/db.ts";
import { readState } from "../src/server/state.ts";
import { readCardProjection } from "../src/server/cards.ts";
import { readBills } from "../src/server/projection-reads-bills.ts";
import { loadCardCompetence } from "../src/server/card-competence.ts";
import { createManualEvent } from "../src/server/manual.ts";
import { backfillBankEvents } from "../src/server/bank-card-events.ts";
import { bankEventsSetup } from "./bank-events-helpers.ts";

// Fase 5 de docs/SPEC-FATOS-CARTAO.md: a carga do passado transforma em evento
// o que já estava pendente, sem chamar o banco, e nenhum número muda em nenhum
// mês. O que a pessoa já aprovou e o que ela ignorou ficam como estavam.

const MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12"];

test("carga do passado: mesmos números mês a mês, aprovado e ignorado intactos", async () => {
  const db = await openDatabase();
  try {
    const { user, familyId, card, account, line, purchase, analyze, status } = await bankEventsSetup(db);
    const checking = await account("checking", "Corrente");
    await purchase("2026-09-05", -10000, "LOJA A");
    const installment = await purchase("2026-09-20", -5000, "LOJA PARCELADA 2/3");
    await db.query(
      `UPDATE bank_transactions SET card_meta='{"installment_number":2,"total_installments":3,"purchase_date":"2026-08-10"}' WHERE id=$1`,
      [installment],
    );
    await purchase("2026-10-18", -10000, "LOJA ROUPAS CENTRO");
    await purchase("2026-10-20", 4000, "ESTORNO LOJA ROUPAS CENTRO");
    await purchase("2026-11-03", -7000, "FARMACIA NOVA", "PENDING");
    await line(checking, "2026-10-20", -30000, "DEBITO AUTOMATICO FATURA CARTAO");
    await line(card, "2026-10-20", 30000, "PAGAMENTO RECEBIDO");
    const pix = await line(checking, "2026-10-08", -5000, "PIX ENVIADO PADARIA");
    await db.query("UPDATE bank_transactions SET operation_type='PIX' WHERE id=$1", [pix]);

    // Já aprovada à mão antes desta mudança, e uma linha que a pessoa ignorou.
    const approvedRow = await purchase("2026-10-02", -20000, "MERCADO X");
    const category = (
      await db.query<{ id: string }>("INSERT INTO categories(id,household_id,name) VALUES(gen_random_uuid(),$1,'Teste mercado') RETURNING id", [
        familyId,
      ])
    ).rows[0].id;
    const approved = await createManualEvent(db, user, {
      account_id: card.local,
      date: "2026-10-02",
      description: "MERCADO X",
      amount: "-200,00",
      kind: "card_purchase",
      category_id: category,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    });
    await db.query("UPDATE bank_transactions SET status='recorded',event_id=$1 WHERE id=$2", [approved, approvedRow]);
    const ignored = await purchase("2026-10-15", -3000, "COMPRA QUE NAO FOI");
    await db.query("UPDATE bank_transactions SET status='ignored' WHERE id=$1", [ignored]);
    await analyze();

    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const m of MONTHS) {
        const s = await readState(db, user, m + "-01", "BRL", undefined, undefined, false);
        // event_count sobe por definição (mais eventos); o resto não pode mudar.
        const { event_count: _count, ...summary } = s.summary;
        void _count;
        out[m] = {
          summary,
          spending: s.competenceSpending,
          projection: (await readCardProjection(db, user, m)).cards,
        };
      }
      out.bills = await asUser(db, user.userId, async (tx) =>
        (await readBills(tx, familyId, await loadCardCompetence(tx, familyId), MONTHS))
          .map((b) => ({ month: b.dueMonth, estimate: b.estimate.toString() }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      );
      return JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    };
    const approvedBefore = (await db.query("SELECT amount_cents::text,kind,category_id FROM economic_events WHERE id=$1", [approved])).rows[0];
    const before = await snapshot();
    assert.notEqual((before["2026-11"] as { summary: { expense_cents: string } }).summary.expense_cents, "0", "números reais");

    const first = await backfillBankEvents(db, user);
    assert.ok(first.created >= 4, "compras pendentes viraram evento");
    assert.equal(first.refunds, 1);
    assert.equal(first.pairs, 1);
    await analyze();
    assert.deepEqual(await snapshot(), before, "mesmos números em todos os meses");

    const rows = await status();
    assert.equal(rows.get(ignored)!.status, "ignored");
    assert.equal(rows.get(approvedRow)!.event_id, approved);
    assert.equal(rows.get(approvedRow)!.auto_recorded, false);
    assert.equal(rows.get(pix)!.status, "pending", "conta corrente fica para a fase 5b");
    assert.deepEqual(
      (await db.query("SELECT amount_cents::text,kind,category_id FROM economic_events WHERE id=$1", [approved])).rows[0],
      approvedBefore,
    );

    const again = await backfillBankEvents(db, user);
    assert.deepEqual(again, { created: 0, refunds: 0, pairs: 0, updated: 0, cancelled: 0, restored: 0 }, "idempotente");
  } finally {
    await db.close();
  }
});
