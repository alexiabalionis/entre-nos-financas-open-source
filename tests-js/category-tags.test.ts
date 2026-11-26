import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, asUser } from "../src/server/db.ts";
import type { Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { UserError } from "../src/server/imports.ts";
import {
  createCategoryTag,
  renameCategoryTag,
  deleteCategoryTag,
  setBankTransactionTag,
} from "../src/server/category-tags.ts";
import { assignEventCategory, learnMerchantRule } from "../src/server/assisted.ts";
import { readState } from "../src/server/state.ts";

async function setup(db: Database, email: string) {
  const userId = await createFamily(
    db,
    {
      name: "Pessoa Fictícia",
      familyName: "Teste",
      email,
      password: "senha-ficticia-longa",
    },
    false,
  );
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user: Identity = {
    userId,
    familyId,
    name: "Pessoa Fictícia",
    email,
    role: "owner",
  };
  const card = randomUUID();
  const eventId = randomUUID();
  const compras = randomUUID();
  const casa = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
    [card, familyId, userId],
  );
  await db.query(
    "INSERT INTO categories(id,household_id,name,essential) VALUES($1,$3,'Compras pessoais',false),($2,$3,'Casa',false) ON CONFLICT(household_id,name) DO NOTHING",
    [compras, casa, familyId],
  );
  const ids = Object.fromEntries(
    (
      await db.query<{ id: string; name: string }>(
        "SELECT id,name FROM categories WHERE household_id=$1 AND name IN ('Compras pessoais','Casa')",
        [familyId],
      )
    ).rows.map((r) => [r.name, r.id]),
  );
  await asUser(db, userId, async (tx) => {
    await tx.query(
      `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
       VALUES($1,$2,$3,'expense','2026-11-05','LOJA X','LOJA X',-1000,'BRL',$4)`,
      [eventId, familyId, card, userId],
    );
    await tx.query(
      `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
       VALUES($1,$2,$3,$4,NULL,'BRL',-1000,'2026-11-05'),($5,$2,$3,NULL,'expense','BRL',1000,'2026-11-05')`,
      [randomUUID(), familyId, eventId, card, randomUUID()],
    );
  });
  return { user, eventId, compras: ids["Compras pessoais"], casa: ids["Casa"] };
}

const userError = (message: string) => (e: unknown) =>
  e instanceof UserError && e.message === message;

async function eventTag(db: Database, user: Identity, id: string) {
  return (
    await asUser(db, user.userId, (tx) =>
      tx.query<{ tag_id: string | null; category_id: string | null; amount_cents: string }>(
        "SELECT tag_id,category_id,amount_cents::text FROM economic_events WHERE id=$1",
        [id],
      ),
    )
  ).rows[0];
}

test("create, rename and list tags with trim and length limits", async () => {
  const db = await openDatabase();
  try {
    const { user, compras } = await setup(db, "tags-a@example.invalid");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "  Vestuário " });
    assert.equal(tag.name, "Vestuário");
    await assert.rejects(
      createCategoryTag(db, user, { category_id: compras, name: "   " }),
      userError("Informe um nome para a etiqueta."),
    );
    await assert.rejects(
      createCategoryTag(db, user, { category_id: compras, name: "a".repeat(121) }),
      userError("O nome pode ter no máximo 120 caracteres."),
    );
    await createCategoryTag(db, user, { category_id: compras, name: "a".repeat(120) });
    const renamed = await renameCategoryTag(db, user, { tag_id: tag.id, name: " Roupas " });
    assert.equal(renamed.name, "Roupas");
    const names = (
      await db.query<{ name: string }>(
        "SELECT name FROM category_tags WHERE household_id=$1 ORDER BY name",
        [user.familyId],
      )
    ).rows.map((r) => r.name);
    assert.equal(names.includes("Roupas"), true);
    assert.equal(names.length, 2);
  } finally {
    await db.close();
  }
});

test("duplicate names are rejected per category, case-insensitive", async () => {
  const db = await openDatabase();
  try {
    const { user, compras, casa } = await setup(db, "tags-b@example.invalid");
    await createCategoryTag(db, user, { category_id: compras, name: "Presentes" });
    const dup = "Já existe uma etiqueta com esse nome nesta categoria.";
    await assert.rejects(
      createCategoryTag(db, user, { category_id: compras, name: " presentes " }),
      userError(dup),
    );
    await createCategoryTag(db, user, { category_id: casa, name: "Presentes" });
    const other = await createCategoryTag(db, user, { category_id: compras, name: "Vestuário" });
    await assert.rejects(
      renameCategoryTag(db, user, { tag_id: other.id, name: "PRESENTES" }),
      userError(dup),
    );
    await renameCategoryTag(db, user, { tag_id: other.id, name: "vestuário" });
  } finally {
    await db.close();
  }
});

test("readers and other families are rejected", async () => {
  const db = await openDatabase();
  try {
    const { user, compras } = await setup(db, "tags-c@example.invalid");
    const other = await setup(db, "tags-d@example.invalid");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "Presentes" });
    const reader = { ...user, role: "reader" as const };
    const ro = "Seu acesso é somente para leitura.";
    await assert.rejects(
      createCategoryTag(db, reader, { category_id: compras, name: "x" }),
      userError(ro),
    );
    await assert.rejects(
      renameCategoryTag(db, reader, { tag_id: tag.id, name: "x" }),
      userError(ro),
    );
    await assert.rejects(deleteCategoryTag(db, reader, { tag_id: tag.id }), userError(ro));
    await assert.rejects(
      createCategoryTag(db, other.user, { category_id: compras, name: "x" }),
      userError("Categoria indisponível."),
    );
    await assert.rejects(
      renameCategoryTag(db, other.user, { tag_id: tag.id, name: "x" }),
      userError("Etiqueta indisponível."),
    );
    await assert.rejects(
      deleteCategoryTag(db, other.user, { tag_id: tag.id }),
      userError("Etiqueta indisponível."),
    );
  } finally {
    await db.close();
  }
});

test("assignEventCategory stores tag, rejects foreign-category tag, clears on change", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId, compras, casa } = await setup(db, "tags-e@example.invalid");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "Vestuário" });
    const out = await assignEventCategory(db, user, {
      event_id: eventId,
      category_name: "Compras pessoais",
      tag_id: tag.id,
    });
    assert.equal(out.tag_id, tag.id);
    let row = await eventTag(db, user, eventId);
    assert.equal(row.tag_id, tag.id);
    assert.equal(row.category_id, compras);
    await assert.rejects(
      assignEventCategory(db, user, { event_id: eventId, category_name: "Casa", tag_id: tag.id }),
      userError("Etiqueta indisponível para esta categoria."),
    );
    row = await eventTag(db, user, eventId);
    assert.equal(row.category_id, compras);
    await renameCategoryTag(db, user, { tag_id: tag.id, name: "Roupas" });
    assert.equal((await eventTag(db, user, eventId)).tag_id, tag.id);
    await assignEventCategory(db, user, { event_id: eventId, category_name: "Casa" });
    row = await eventTag(db, user, eventId);
    assert.equal(row.category_id, casa);
    assert.equal(row.tag_id, null);
  } finally {
    await db.close();
  }
});

test("composite FK refuses a tag from another category at the database", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId, compras, casa } = await setup(db, "tags-f@example.invalid");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "Vestuário" });
    await assert.rejects(
      asUser(db, user.userId, (tx) =>
        tx.query("UPDATE economic_events SET category_id=$1,tag_id=$2 WHERE id=$3", [
          casa,
          tag.id,
          eventId,
        ]),
      ),
    );
  } finally {
    await db.close();
  }
});

test("deleteCategoryTag clears events and keeps category and amount", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId, compras } = await setup(db, "tags-g@example.invalid");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "Vestuário" });
    await assignEventCategory(db, user, {
      event_id: eventId,
      category_name: "Compras pessoais",
      tag_id: tag.id,
    });
    const out = await deleteCategoryTag(db, user, { tag_id: tag.id });
    assert.deepEqual(out, { tag_id: tag.id, cleared: 1 });
    const row = await eventTag(db, user, eventId);
    assert.equal(row.tag_id, null);
    assert.equal(row.category_id, compras);
    assert.equal(row.amount_cents, "-1000");
    const left = await db.query("SELECT 1 FROM category_tags WHERE id=$1", [tag.id]);
    assert.equal(left.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("readState exposes categories[].tags and event tag fields", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId, compras } = await setup(db, "tags-h@example.invalid");
    const b = await createCategoryTag(db, user, { category_id: compras, name: "Presentes" });
    const a = await createCategoryTag(db, user, { category_id: compras, name: "Vestuário" });
    await assignEventCategory(db, user, {
      event_id: eventId,
      category_name: "Compras pessoais",
      tag_id: a.id,
    });
    const state = await readState(db, user, "2026-11-01", "BRL");
    const cat = state.categories.find((c) => c.id === compras);
    assert.deepEqual(cat?.tags, [
      { id: b.id, name: "Presentes", uses: 0 },
      { id: a.id, name: "Vestuário", uses: 1 },
    ]);
    const event = state.events.find((e) => e.id === eventId);
    assert.equal(event?.tag_id, a.id);
    assert.equal(event?.tag_name, "Vestuário");
  } finally {
    await db.close();
  }
});

async function bankRow(db: Database, user: Identity, description: string) {
  const local = randomUUID();
  const connection = randomUUID();
  const bankAccount = randomUUID();
  const id = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Conta','Teste','BRL','checking',$3)",
    [local, user.familyId, user.userId],
  );
  await db.query(
    "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic-not-a-secret')",
    [user.familyId, user.userId],
  );
  await db.query(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Banco','Titular','2026-11-01')",
    [connection, user.familyId, user.userId, randomUUID()],
  );
  await db.query(
    "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Conta','BRL','BANK',$5)",
    [bankAccount, user.familyId, connection, randomUUID(), local],
  );
  await db.query(
    "INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,'2026-11-05',$6,-1000,'BRL','POSTED','synthetic',$7)",
    [id, user.familyId, bankAccount, local, randomUUID(), description, randomUUID()],
  );
  return id;
}

async function bankTag(db: Database, id: string) {
  return (
    await db.query<{ tag_id: string | null }>(
      "SELECT tag_id FROM bank_transactions WHERE id=$1",
      [id],
    )
  ).rows[0].tag_id;
}

test("setBankTransactionTag saves, clears and guards the bank row", async () => {
  const db = await openDatabase();
  try {
    const { user, compras, casa } = await setup(db, "tags-i@example.invalid");
    await learnMerchantRule(db, user, {
      match_text: "MERCADO TESTE",
      category_name: "Compras pessoais",
    });
    const id = await bankRow(db, user, "MERCADO TESTE CENTRO");
    const ok = await createCategoryTag(db, user, { category_id: compras, name: "Mercado" });
    const wrong = await createCategoryTag(db, user, { category_id: casa, name: "Reforma" });
    await setBankTransactionTag(db, user, { bank_transaction_id: id, tag_id: ok.id });
    assert.equal(await bankTag(db, id), ok.id);
    await setBankTransactionTag(db, user, { bank_transaction_id: id, tag_id: null });
    assert.equal(await bankTag(db, id), null);
    await assert.rejects(
      setBankTransactionTag(db, user, { bank_transaction_id: id, tag_id: wrong.id }),
      userError("Etiqueta indisponível para esta categoria."),
    );
    const other = await setup(db, "tags-j@example.invalid");
    await assert.rejects(
      setBankTransactionTag(db, other.user, { bank_transaction_id: id, tag_id: null }),
      userError("Movimento indisponível."),
    );
    await assert.rejects(
      setBankTransactionTag(db, { ...user, role: "reader" }, { bank_transaction_id: id, tag_id: null }),
      userError("Seu acesso é somente para leitura."),
    );
  } finally {
    await db.close();
  }
});

test("readState shows the bank row tag only while the category matches; delete clears; uses sums both", async () => {
  const db = await openDatabase();
  try {
    const { user, eventId, compras } = await setup(db, "tags-k@example.invalid");
    await learnMerchantRule(db, user, {
      match_text: "MERCADO TESTE",
      category_name: "Compras pessoais",
    });
    const id = await bankRow(db, user, "MERCADO TESTE CENTRO");
    const tag = await createCategoryTag(db, user, { category_id: compras, name: "Mercado" });
    await assignEventCategory(db, user, {
      event_id: eventId,
      category_name: "Compras pessoais",
      tag_id: tag.id,
    });
    await setBankTransactionTag(db, user, { bank_transaction_id: id, tag_id: tag.id });
    let state = await readState(db, user, "2026-11-01", "BRL");
    let row = state.bankPending.find((r) => r.id === id);
    assert.equal(row?.tag_id, tag.id);
    assert.equal(row?.tag_name, "Mercado");
    assert.equal(state.categories.find((c) => c.id === compras)?.tags[0].uses, 2);
    await learnMerchantRule(db, user, {
      match_text: "MERCADO TESTE",
      category_name: "Casa",
    });
    state = await readState(db, user, "2026-11-01", "BRL");
    row = state.bankPending.find((r) => r.id === id);
    assert.equal(row?.tag_id, null);
    assert.equal(row?.tag_name, null);
    assert.equal(await bankTag(db, id), tag.id);
    const out = await deleteCategoryTag(db, user, { tag_id: tag.id });
    assert.equal(out.cleared, 2);
    assert.equal(await bankTag(db, id), null);
  } finally {
    await db.close();
  }
});
