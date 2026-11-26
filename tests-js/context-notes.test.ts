import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser, type Database } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import {
  deleteNote,
  listContext,
  readSobraPaths,
  saveNote,
  setProtected,
} from "../src/server/context-notes.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";

async function member(db: Database, email: string) {
  await createFamily(db, { email, name: "N", password: "SenhaFicticia!2026", familyName: "F" });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  return (await identity(db, await issueSession(db, userId)))!;
}

test("notas: salva, lista, substitui, apaga por escopo e isola por casa", async () => {
  const db = await openDatabase();
  try {
    const a = await member(db, "ctx-a@example.invalid");
    const b = await member(db, "ctx-b@example.invalid");
    await saveNote(db, a, { scope: "household", note: "  Casa de aluguel  " });
    await saveNote(db, a, { scope: "category", category: "Lazer", note: "Viagem em família" });
    await saveNote(db, a, { scope: "category_month", category: "Lazer", month: "2026-10", note: "Aniversário" });
    await saveNote(db, a, { scope: "category_month", category: "Lazer", month: "2026-09", note: "Show" });
    let ctx = await listContext(db, a);
    assert.equal(ctx.household, "Casa de aluguel");
    assert.deepEqual(ctx.categories, [{ name: "Lazer", protected: false, note: "Viagem em família" }]);
    assert.equal(ctx.monthNotes.length, 2);
    assert.deepEqual((await listContext(db, a, { month: "2026-10" })).monthNotes, [
      { name: "Lazer", month: "2026-10", note: "Aniversário" },
    ]);
    // upsert substitui, não duplica
    await saveNote(db, a, { scope: "household", note: "Nova" });
    await saveNote(db, a, { scope: "category_month", category: "Lazer", month: "2026-10", note: "Outra" });
    ctx = await listContext(db, a);
    assert.equal(ctx.household, "Nova");
    assert.equal(ctx.monthNotes.find((m) => m.month === "2026-10")?.note, "Outra");
    assert.equal(ctx.monthNotes.length, 2);
    // outra casa não vê
    assert.deepEqual(await listContext(db, b), { household: null, categories: [], monthNotes: [] });
    // apaga
    await deleteNote(db, a, { scope: "category_month", category: "Lazer", month: "2026-10" });
    await deleteNote(db, a, { scope: "household" });
    await deleteNote(db, a, { scope: "category", category: "Lazer" });
    ctx = await listContext(db, a);
    assert.equal(ctx.household, null);
    assert.deepEqual(ctx.categories, []);
    assert.deepEqual(ctx.monthNotes.map((m) => m.month), ["2026-09"]);
  } finally {
    await db.close();
  }
});

test("notas: entradas inválidas e papel de leitor são rejeitados", async () => {
  const db = await openDatabase();
  try {
    const a = await member(db, "ctx-bad@example.invalid");
    const bad = [
      { scope: "household", category: "Lazer", note: "x" },
      { scope: "category", note: "x" },
      { scope: "category", category: "Lazer", month: "2026-10", note: "x" },
      { scope: "category_month", category: "Lazer", note: "x" },
      { scope: "category_month", month: "2026-10", note: "x" },
      { scope: "outro", note: "x" },
      { scope: "household", note: "   " },
      { scope: "household", note: "x".repeat(501) },
      { scope: "category_month", category: "Lazer", month: "2026-13", note: "x" },
      { scope: "household", note: "x", extra: 1 },
      { scope: "category", category: "Inexistente", note: "x" },
    ];
    for (const raw of bad) await assert.rejects(saveNote(db, a, raw), JSON.stringify(raw));
    await assert.rejects(deleteNote(db, a, { scope: "category" }));
    await assert.rejects(setProtected(db, a, { category: "Inexistente", protected: true }));
    await assert.rejects(setProtected(db, a, { category: "Lazer", protected: "sim" }));
    const reader = { ...a, role: "reader" as const };
    await assert.rejects(saveNote(db, reader, { scope: "household", note: "x" }));
    await assert.rejects(deleteNote(db, reader, { scope: "household" }));
    await assert.rejects(setProtected(db, reader, { category: "Lazer", protected: true }));
    assert.deepEqual(await listContext(db, a), { household: null, categories: [], monthNotes: [] });
  } finally {
    await db.close();
  }
});

test("protegida: ida e volta e aparece na lista", async () => {
  const db = await openDatabase();
  try {
    const a = await member(db, "ctx-prot@example.invalid");
    await setProtected(db, a, { category: "Lazer", protected: true });
    assert.deepEqual((await listContext(db, a)).categories, [{ name: "Lazer", protected: true, note: null }]);
    await setProtected(db, a, { category: "Lazer", protected: false });
    assert.deepEqual((await listContext(db, a)).categories, []);
  } finally {
    await db.close();
  }
});

test("readSobraPaths: ignora conta fixa e categoria protegida", async () => {
  const db = await openDatabase();
  try {
    const user = await member(db, "ctx-sobra@example.invalid");
    await assert.rejects(readSobraPaths(db, user, {}));
    await assert.rejects(readSobraPaths(db, user, { pct: 5, cents: "100" }));
    await assert.rejects(readSobraPaths(db, user, { pct: 90 }));
    assert.equal(await readSobraPaths(db, user, { pct: 10 }), null);

    const bank = randomUUID();
    const now = new Date();
    const mk = (back: number, day: number) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, day));
      return d.toISOString().slice(0, 10);
    };
    await asUser(db, user.userId, async (tx) => {
      await tx.query(
        "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2020-01-01',$3)",
        [bank, user.familyId, user.userId],
      );
      const cat = async (n: string) =>
        (await tx.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [user.familyId, n])).rows[0].id;
      const lazer = await cat("Lazer");
      const pet = await cat("Alimentação");
      const moradia = await cat("Moradia");
      const add = async (kind: string, date: string, cents: number, category: string | null, desc = "X") => {
        const id = randomUUID();
        const signed = kind === "income" ? cents : -cents;
        await tx.query(
          `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
           VALUES($1,$2,$3,$4,$5,$9,$9,$6,'BRL',$7,$8)`,
          [id, user.familyId, bank, kind, date, signed, category, user.userId, desc],
        );
        await tx.query(
          `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
           VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,$9,'BRL',$7,$8)`,
          [randomUUID(), user.familyId, id, bank, randomUUID(), signed, -signed, date, kind],
        );
      };
      // 4 meses fechados: renda 100000; Lazer normal 5000 e 20000 no mês mais recente; Alimentação igual
      for (const back of [4, 3, 2, 1]) {
        await add("income", mk(back, 5), 100000, null);
        const extra = back === 1 ? 20000 : 5000;
        await add("expense", mk(back, 10), extra, lazer);
        await add("expense", mk(back, 11), extra, pet);
        // aluguel alto no mês mais recente, conciliado a uma série: é conta fixa
        await add("expense", mk(back, 12), back === 1 ? 90000 : 1000, moradia, "aluguel");
      }
    });
    // série de despesa com item conciliado a cada aluguel (fixo, fora dos cortes)
    const moradiaId = (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Moradia'", [user.familyId])).rows[0].id;
    await createRecurrence(db, user, { purpose: "expense", label: "Aluguel", category_id: moradiaId, expected_cents: 1000, frequency: "month", start_date: mk(4, 12), today: mk(0, 1) });
    const rents = (await db.query<{ id: string }>("SELECT id FROM economic_events WHERE household_id=$1 AND description='aluguel'", [user.familyId])).rows;
    const items = (await db.query<{ id: string }>("SELECT i.id FROM monthly_items i JOIN recurrence_occurrences o ON o.monthly_item_id=i.id WHERE i.household_id=$1 ORDER BY i.month", [user.familyId])).rows;
    assert.ok(items.length >= 4, "série gera itens nos meses fechados");
    for (let k = 0; k < 4; k++)
      await db.query("UPDATE monthly_items SET event_id=(SELECT id FROM economic_events WHERE household_id=$1 AND description='aluguel' AND transaction_date=$3::date) WHERE id=$2", [user.familyId, items[k].id, mk(4 - k, 12)]);
    void rents;
    const open = await readSobraPaths(db, user, { cents: "99999999" });
    assert.ok(open);
    assert.deepEqual(open.steps.map((s) => s.name).sort(), ["Alimentação", "Lazer"]);
    await setProtected(db, user, { category: "Alimentação", protected: true });
    const prot = await readSobraPaths(db, user, { pct: 80 });
    assert.ok(prot);
    assert.deepEqual(prot.steps.map((s) => s.name), ["Lazer"]);
    assert.deepEqual(prot.protectedAbove.map((s) => s.name), ["Alimentação"]);
  } finally {
    await db.close();
  }
});
