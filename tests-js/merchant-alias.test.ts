import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { renameEvent } from "../src/server/rename.ts";
import { readMerchantAlias, setMerchantAlias } from "../src/server/merchant-alias.ts";
import { allowedMethods } from "../src/server/api-policy.ts";
import { readState } from "../src/server/state.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { merchantKey } from "../src/domain/merchant-key.ts";
import { eventName } from "../src/domain/event-name.ts";
import { promptLabel, bankMovement } from "../src/domain/movements.ts";
import { runTool } from "../src/server/judite-tools.ts";

const DESCRIPTIONS = [
  "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44",
  "Pix - Fernanda Souza",
  "Pix para Maria Silva Santos",
  "PIX RECEBIDO JOÃO DA SILVA 123.456.789-00",
  "TED enviada para Ação Imobiliária Ltda CNPJ 12.345.678/0001-90",
  "DOC recebido de Fundação São José",
  "Transferência enviada Conceição Ávila",
  "Transferência recebida - ÓTICA NOVA",
  "PAG*JOSEFA 12",
  "IFOOD PEDIDO",
  "IFD*PADARIA SÃO PEDRO 05/12",
  "MERCADO LIVRE*2 PARCELAS",
  "Uber *Trip 1234",
  "NETFLIX.COM",
  "Posto Ipiranga - Açaí & Cia",
  "PÃO DE AÇÚCAR 0142",
  "Farmácia São João Nº 22",
  "CAFÉ DO ZÉ",
  "Pagamento de boleto Condomínio Edifício Águas Claras",
  "Compra no débito - LOJA DA VOVÓ",
  "pix pix pix",
  "TRANSFERENCIA PIX DOCES DA TIA",
  "Cartão final 1234 - AMAZON BR",
  "Pará Mineração Ltda",
  "Restaurante Tête-à-Tête / Centro",
];

// Cópia da regra que existia em judite-tools-patterns.ts antes de virar merchantKey.
const recipientKeyBefore = (description: string) =>
  description
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(pix|ted|doc|transf\w*|enviad[oa]|recebid[oa]|para|cpf|cnpj)\b/g, " ")
    .replace(/[\d.*/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function family(db: Awaited<ReturnType<typeof openDatabase>>, email: string) {
  const userId = await createFamily(db, { name: "Pessoa fictícia", familyName: "Teste", email, password: "SenhaFicticia!2026" });
  const familyId = (await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])).rows[0]
    .household_id;
  const user: Identity = { userId, familyId, name: "Pessoa", email, role: "owner" };
  const account = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Corrente','Teste','BRL','checking',$3)",
    [account, familyId, userId],
  );
  const category = randomUUID();
  await db.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,'Outros')", [category, familyId]);
  const add = (description: string, amount = "-30,00") =>
    asUser(db, userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id: account,
        date: settledToday(),
        description,
        amount,
        kind: "expense",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    );
  return { user, account, add };
}

const eventId = async (db: Awaited<ReturnType<typeof openDatabase>>, familyId: string, description: string) =>
  (await db.query<{ id: string }>("SELECT id FROM economic_events WHERE household_id=$1 AND description=$2 LIMIT 1", [familyId, description]))
    .rows[0].id;

test("merchantKey dá o mesmo resultado que a regra antiga de recipientKey e que merchant_key em SQL", async () => {
  const db = await openDatabase();
  try {
    assert.ok(DESCRIPTIONS.length >= 20);
    for (const d of DESCRIPTIONS) {
      assert.equal(merchantKey(d), recipientKeyBefore(d), d);
      const sql = (await db.query<{ k: string }>("SELECT merchant_key($1) AS k", [d])).rows[0].k;
      assert.equal(sql, merchantKey(d), d);
    }
    assert.equal(merchantKey("PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44"), "fernanda souza");
  } finally {
    await db.close();
  }
});

test("a migration 042 roda duas vezes sem erro", async () => {
  const db = await openDatabase();
  try {
    const sql = await readFile("db/migrations/042_merchant_aliases.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
  } finally {
    await db.close();
  }
});

test("apelido vale para a chave, perde para o nome do lançamento e não vaza para outra casa", async () => {
  const db = await openDatabase();
  try {
    const a = await family(db, "alias-a@example.invalid");
    const b = await family(db, "alias-b@example.invalid");
    const pix = "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44";
    const other = "Pix - Fernanda Souza Lima";
    await a.add(pix);
    await a.add(pix.replace("333-44", "333-45"));
    await a.add(other);
    await b.add(pix);
    const id = await eventId(db, a.user.familyId, pix);

    const result = await setMerchantAlias(db, a.user, { movement_id: `event:${id}`, alias: " Faxina " });
    assert.equal(result.alias, "Faxina");
    assert.equal(result.key_count, 2);

    const month = settledToday().slice(0, 7) + "-01";
    const state = await readState(db, a.user, month, "BRL");
    const named = state.events.filter((e) => e.description.startsWith("PIX ENVIADO"));
    assert.equal(named.length, 2);
    for (const e of named) {
      assert.equal(e.alias_name, "Faxina");
      assert.equal(e.name, "Faxina");
      assert.equal(promptLabel({ aliasName: e.alias_name, description: e.description, kind: e.kind, amount: e.amount_cents }), "Faxina");
    }
    assert.equal(state.events.find((e) => e.description === other)?.alias_name ?? null, null);

    const stateB = await readState(db, b.user, month, "BRL");
    assert.equal(stateB.events[0].alias_name ?? null, null);
    assert.equal(stateB.events[0].name, pix);
    const seenByB = await asUser(db, b.user.userId, (tx) => tx.query("SELECT 1 FROM merchant_aliases"));
    assert.equal(seenByB.rows.length, 0);

    await renameEvent(db, a.user, { event_id: id, name: "Faxineira de março" });
    const after = await readState(db, a.user, month, "BRL");
    assert.equal(after.events.find((e) => e.id === id)?.name, "Faxineira de março");
    assert.equal(after.events.filter((e) => e.name === "Faxina").length, 1);

    const cleared = await setMerchantAlias(db, a.user, { movement_id: `event:${id}`, alias: null });
    assert.equal(cleared.key_count, 2);
    assert.equal((await db.query("SELECT 1 FROM merchant_aliases")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("leitor não grava apelido, e o movimento de outra casa é recusado", async () => {
  const db = await openDatabase();
  try {
    const a = await family(db, "alias-r1@example.invalid");
    const b = await family(db, "alias-r2@example.invalid");
    await a.add("PAG*JOSEFA 12");
    await b.add("PAG*JOSEFA 12");
    const id = await eventId(db, a.user.familyId, "PAG*JOSEFA 12");
    await assert.rejects(setMerchantAlias(db, { ...a.user, role: "reader" }, { movement_id: `event:${id}`, alias: "Feira" }), /somente para leitura/);
    await assert.rejects(setMerchantAlias(db, b.user, { movement_id: `event:${id}`, alias: "Feira" }), /indisponível/);
    await assert.rejects(setMerchantAlias(db, a.user, { movement_id: `event:${id}`, alias: "x".repeat(61) }), /no máximo 60/);
    assert.equal((await db.query("SELECT 1 FROM merchant_aliases")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("eventName: display_name vence o apelido da chave, que vence a descrição", () => {
  assert.equal(eventName({ display_name: "Meu", alias_name: "Faxina", description: "PIX X" }), "Meu");
  assert.equal(eventName({ display_name: " ", alias_name: "Faxina", description: "PIX X" }), "Faxina");
  assert.equal(eventName({ display_name: null, alias_name: null, description: "PIX X" }), "PIX X");
});

test("movimento do banco pendente mostra o apelido e promptLabel o usa no lugar de Pix enviado", () => {
  const row = bankMovement({
    id: "1",
    version: 1,
    transaction_date: "2026-11-02",
    description: "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44",
    amount_cents: "-5000",
    account_name: "Corrente",
    account_kind: "checking",
    group: null,
    autospend: true,
    scheduled: false,
    suggested_category: "Outros",
    tag_id: null,
    tag_name: null,
    alias_name: "Faxina",
  });
  assert.equal(row?.name, "Faxina");
  assert.equal(promptLabel({ ...row!, kind: row!.kind }), "Faxina");
  assert.equal(promptLabel({ description: row!.description, kind: "expense", amount: "-5000" }), "Pix enviado");
});

test("com apelido, o resultado da ferramenta mostra o apelido e nenhum nome de pessoa", async () => {
  const db = await openDatabase();
  try {
    const a = await family(db, "alias-tool@example.invalid");
    const pix = "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44";
    await a.add(pix);
    const id = await eventId(db, a.user.familyId, pix);
    const ctx = {
      db,
      user: a.user,
      catalog: { categories: [], accounts: [{ id: a.account, name: "Corrente", kind: "checking", currency: "BRL" as const }], goals: [] },
      currency: "BRL" as const,
      cache: {},
    };
    const before = JSON.stringify(await runTool(ctx, { name: "buscar_movimentos", texto: "pix" }));
    assert.match(before, /Pix enviado/);
    await setMerchantAlias(db, a.user, { movement_id: `event:${id}`, alias: "Faxina" });
    const out = JSON.stringify(await runTool({ ...ctx, cache: {} }, { name: "buscar_movimentos", texto: "pix" }));
    assert.match(out, /Faxina/);
    assert.doesNotMatch(out, /fernanda|souza/i);
  } finally {
    await db.close();
  }
});

test("a leitura do apelido mostra o alcance antes de salvar e não vaza para outra casa", async () => {
  const db = await openDatabase();
  try {
    assert.deepEqual(allowedMethods("merchant-alias"), ["GET", "POST"]);
    const a = await family(db, "alias-g1@example.invalid");
    const b = await family(db, "alias-g2@example.invalid");
    const pix = "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44";
    await a.add(pix);
    await a.add(pix.replace("333-44", "333-45"));
    await b.add(pix);
    const id = await eventId(db, a.user.familyId, pix);

    assert.deepEqual(await readMerchantAlias(db, a.user, `event:${id}`), { alias: null, key_count: 2 });
    await setMerchantAlias(db, a.user, { movement_id: `event:${id}`, alias: "Faxina" });
    assert.deepEqual(await readMerchantAlias(db, a.user, `event:${id}`), { alias: "Faxina", key_count: 2 });
    await assert.rejects(readMerchantAlias(db, b.user, `event:${id}`), /indisponível/);
    await assert.rejects(readMerchantAlias(db, a.user, "event:nao-e-uuid"));
  } finally {
    await db.close();
  }
});
