import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";

// Fase 1 de docs/SPEC-FATOS-CARTAO.md: colunas de cancelamento e de origem da
// competência em economic_events. Anuláveis, com as regras de coerência.
test("economic_events aceita cancelamento e origem de competência, com checagens", async () => {
  const db = await openDatabase();
  try {
    const email = "cancel-competence@example.invalid";
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
    const account = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Teste','BRL','checking',$3)`,
      [account, familyId, userId],
    );
    const category = randomUUID();
    await db.query(
      "INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Compras')",
      [category, familyId],
    );
    const event = await asUser(db, userId, (t) =>
      createManualEventTx(t, user, {
        account_id: account,
        date: "2026-10-25",
        description: "LOJA TESTE",
        amount: "-10,00",
        kind: "expense",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
    const read = async () =>
      (
        await db.query<{
          cancelled_at: string | null;
          cancel_reason: string | null;
          competence_source: string | null;
        }>(
          "SELECT cancelled_at::text,cancel_reason,competence_source FROM economic_events WHERE id=$1",
          [event],
        )
      ).rows[0];

    // Evento existente não muda de comportamento: tudo nulo.
    assert.deepEqual(await read(), {
      cancelled_at: null,
      cancel_reason: null,
      competence_source: null,
    });

    // Cancelar e registrar a origem da competência.
    await db.query(
      "UPDATE economic_events SET cancelled_at=now(),cancel_reason='Sumiu do banco',competence_source='bill' WHERE id=$1",
      [event],
    );
    const after = await read();
    assert.ok(after.cancelled_at);
    assert.equal(after.cancel_reason, "Sumiu do banco");
    assert.equal(after.competence_source, "bill");

    // Origem fora da lista é recusada.
    await assert.rejects(
      db.query(
        "UPDATE economic_events SET competence_source='palpite' WHERE id=$1",
        [event],
      ),
    );
    // Motivo sem cancelamento é recusado.
    await db.query(
      "UPDATE economic_events SET cancelled_at=NULL,cancel_reason=NULL WHERE id=$1",
      [event],
    );
    await assert.rejects(
      db.query("UPDATE economic_events SET cancel_reason='x' WHERE id=$1", [
        event,
      ]),
    );
    // Motivo vazio é recusado.
    await assert.rejects(
      db.query(
        "UPDATE economic_events SET cancelled_at=now(),cancel_reason='   ' WHERE id=$1",
        [event],
      ),
    );
    // Finalidade do gasto: opcional, entre 1 e 500 caracteres.
    await db.query(
      "UPDATE economic_events SET purpose_note='Presente da Paula' WHERE id=$1",
      [event],
    );
    await assert.rejects(
      db.query("UPDATE economic_events SET purpose_note='  ' WHERE id=$1", [
        event,
      ]),
    );
    await assert.rejects(
      db.query("UPDATE economic_events SET purpose_note=$2 WHERE id=$1", [
        event,
        "x".repeat(501),
      ]),
    );
  } finally {
    await db.close();
  }
});
