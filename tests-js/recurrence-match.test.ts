import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { UserError } from "../src/server/imports.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { allowedMethods } from "../src/server/api-policy.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { searchCandidates } from "../src/server/recurrence-match.ts";
import {
  checkItem,
  copyMonth,
  readRoutine,
  saveItem,
} from "../src/server/routine.ts";

const TODAY = "2026-11-09";

async function setup(db: PGlite, tag: string) {
  const email = `match-${tag}@example.invalid`;
  await createFamily(db, {
    email,
    name: tag,
    password: "SenhaFicticia!2026",
    familyName: tag,
  });
  const userId = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [
      email,
    ])
  ).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (
    await db.query<{ id: string }>(
      "SELECT id FROM categories WHERE household_id=$1 LIMIT 1",
      [user.familyId],
    )
  ).rows[0].id;
  const account = async (kind: string, currency = "BRL") => {
    const id = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Teste',$4,$5,$6)",
      [
        id,
        user.familyId,
        `${kind}-${currency}-${id.slice(0, 4)}`,
        currency,
        kind,
        userId,
      ],
    );
    return id;
  };
  const checking = await account("checking");
  const event = (
    account_id: string,
    date: string,
    description: string,
    amount: string,
    kind = "expense",
  ) =>
    asUser(db, user.userId, (tx) =>
      createManualEventTx(tx, user, {
        account_id,
        date,
        description,
        amount,
        kind,
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
      }),
    ) as Promise<string>;
  const series = async (account_id: string | null, label = "Academia") => {
    await createRecurrence(db, user, {
      purpose: "expense",
      label,
      category_id: category,
      account_id,
      expected_cents: 15000,
      frequency: "month",
      start_date: "2026-11-05",
      today: TODAY,
    });
  };
  const item = async (label: string, month: string) =>
    (
      await db.query<{
        id: string;
        version: number;
        month: string;
        due_date: string | null;
      }>(
        "SELECT id,version,month::text,due_date::text FROM monthly_items WHERE household_id=$1 AND label=$2 AND month=$3 AND NOT archived",
        [user.familyId, label, month + "-01"],
      )
    ).rows[0];
  const check = (
    i: { id: string; version: number },
    event_id: string,
    extra: Record<string, unknown> = {},
  ) =>
    checkItem(db, user, {
      id: i.id,
      version: i.version,
      status: "done",
      event_id,
      ...extra,
    });
  const plain = async (label: string, month: string, amount = "150,00") => {
    const { id } = await saveItem(db, user, {
      month,
      label,
      purpose: "expense",
      currency: "BRL",
      amount,
      due_date: null,
      category_id: null,
      notes: "",
    });
    return (
      await db.query<{ id: string; version: number }>(
        "SELECT id,version FROM monthly_items WHERE id=$1",
        [id],
      )
    ).rows[0];
  };
  const candidates = async (month: string, id: string) =>
    (await readRoutine(db, user, month)).items
      .find((i) => i.id === id)!
      .candidates.map((c) => c.id);
  return {
    user,
    category,
    account,
    checking,
    event,
    series,
    item,
    check,
    plain,
    candidates,
  };
}

test("série no cartão aceita card_purchase, recusa expense e não muda mês nem vencimento", async () => {
  const db = await openDatabase();
  try {
    const { account, event, series, item, check } = await setup(db, "card");
    const card = await account("card");
    await series(card);
    const before = await item("Academia", "2026-12");
    const wrong = await event(
      card,
      "2026-12-05",
      "ACADEMIA",
      "-150,00",
      "expense",
    );
    await assert.rejects(check(before, wrong), UserError);
    const right = await event(
      card,
      "2027-02-10",
      "ACADEMIA",
      "-150,00",
      "card_purchase",
    );
    await check(before, right);
    const after = await item("Academia", "2026-12");
    assert.equal(after.month, before.month);
    assert.equal(after.due_date, before.due_date);
  } finally {
    await db.close();
  }
});

test("série em conta recusa evento de outra conta sem allow_other_account e audita com ele", async () => {
  const db = await openDatabase();
  try {
    const { account, checking, event, series, item, check } = await setup(
      db,
      "account",
    );
    const other = await account("checking");
    await series(checking);
    const target = await item("Academia", "2026-12");
    const foreign = await event(other, "2026-12-05", "ACADEMIA", "-150,00");
    await assert.rejects(check(target, foreign), UserError);
    await assert.rejects(
      check(target, foreign, { allow_other_account: false }),
      UserError,
    );
    await check(target, foreign, { allow_other_account: true });
    const audit = await db.query<{
      metadata: { allow_other_account?: boolean };
    }>(
      "SELECT metadata FROM audit_events WHERE action='routine.check' AND entity_id=$1",
      [target.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].metadata.allow_other_account, true);
    const same = await item("Academia", "2027-01");
    await check(
      same,
      await event(checking, "2027-01-05", "ACADEMIA", "-150,00"),
    );
    const plainAudit = await db.query<{
      metadata: { allow_other_account?: boolean };
    }>(
      "SELECT metadata FROM audit_events WHERE action='routine.check' AND entity_id=$1",
      [same.id],
    );
    assert.equal(plainAudit.rows[0].metadata.allow_other_account, undefined);
  } finally {
    await db.close();
  }
});

test("item fora de série: candidatos só do mês e valor exato; check aceita os mesmos tipos de antes", async () => {
  const db = await openDatabase();
  try {
    const { account, checking, event, plain, check, candidates } = await setup(
      db,
      "plain",
    );
    const other = await account("checking");
    const item = await plain("Luz", "2026-11");
    const exact = await event(checking, "2026-11-12", "LUZ", "-150,00");
    await event(checking, "2026-11-13", "LUZ", "-165,00");
    await event(checking, "2026-12-02", "LUZ", "-150,00");
    assert.deepEqual(await candidates("2026-11", item.id), [exact]);
    const card = await account("card");
    await check(
      item,
      await event(card, "2026-11-20", "LUZ", "-150,00", "card_purchase"),
    );
    const again = await plain("Água", "2026-11");
    await check(again, await event(other, "2026-11-21", "AGUA", "-150,00"));
  } finally {
    await db.close();
  }
});

test("sugestão de série acha R$165 contra R$150 no mês seguinte e ignora evento já vinculado", async () => {
  const db = await openDatabase();
  try {
    const { checking, event, series, item, plain, check, candidates } =
      await setup(db, "suggest");
    await series(checking);
    const target = await item("Academia", "2026-11");
    const next = await event(checking, "2026-12-03", "ACADEMIA", "-165,00");
    const far = await event(checking, "2026-11-20", "OUTRA", "-300,00");
    const linked = await event(checking, "2026-11-22", "ACADEMIA", "-160,00");
    await check(await plain("Outro", "2026-11"), linked);
    const found = await candidates("2026-11", target.id);
    assert.ok(found.includes(next));
    assert.ok(!found.includes(linked));
    assert.ok(!found.includes(far));
  } finally {
    await db.close();
  }
});

test("searchCandidates: sem limite de data, respeita q, tipo, moeda, vínculo e família", async () => {
  const db = await openDatabase();
  try {
    const { user, account, checking, event, series, item, plain, check } =
      await setup(db, "search");
    const usd = await account("checking", "USD");
    const card = await account("card");
    await series(checking);
    const target = await item("Academia", "2026-11");
    const old = await event(
      checking,
      "2026-06-10",
      "ACADEMIA CENTRO",
      "-150,00",
    );
    const padaria = await event(checking, "2026-06-11", "PADARIA", "-20,00");
    await event(usd, "2026-06-12", "ACADEMIA USD", "-150,00");
    await event(
      card,
      "2026-06-13",
      "ACADEMIA CARTAO",
      "-150,00",
      "card_purchase",
    );
    await event(checking, "2026-06-14", "ACADEMIA SALARIO", "150,00", "income");
    const linked = await event(
      checking,
      "2026-06-15",
      "ACADEMIA VINCULADA",
      "-150,00",
    );
    await check(await plain("Outro", "2026-06"), linked);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const all = await searchCandidates(db, user, { item_id: target.id });
    assert.deepEqual(ids(all).sort(), [old, padaria].sort());
    const filtered = await searchCandidates(db, user, {
      item_id: target.id,
      q: "academia",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    assert.deepEqual(ids(filtered), [old]);
    const stranger = await setup(db, "stranger");
    const foreignEvent = await stranger.event(
      stranger.checking,
      "2026-06-17",
      "ACADEMIA ESTRANHA",
      "-150,00",
    );
    const mine = await searchCandidates(db, user, {
      item_id: target.id,
      q: "ESTRANHA",
    });
    assert.ok(!ids(mine).includes(foreignEvent));
    await assert.rejects(
      searchCandidates(db, stranger.user, { item_id: target.id }),
      UserError,
    );
  } finally {
    await db.close();
  }
});

test("copyMonth não copia item de série e continua copiando os demais", async () => {
  const db = await openDatabase();
  try {
    const { user, checking, series, plain } = await setup(db, "copy");
    await series(checking);
    await plain("Aluguel", "2026-11");
    const result = await copyMonth(db, user, {
      from: "2026-11",
      to: "2027-01",
    });
    assert.equal(result.copied, 1);
    const labels = (
      await db.query<{ label: string; n: number }>(
        "SELECT label,count(*)::int n FROM monthly_items WHERE household_id=$1 AND month='2027-01-01' AND NOT archived GROUP BY label ORDER BY label",
        [user.familyId],
      )
    ).rows;
    assert.deepEqual(labels, [
      { label: "Academia", n: 1 },
      { label: "Aluguel", n: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("api-policy: rotas novas de recorrência e busca estão na allowlist", () => {
  for (const route of [
    "create",
    "from-event",
    "sync",
    "preview",
    "apply",
    "end",
    "pause",
    "cancel",
    "move",
    "due",
    "convert",
    "migrate-income",
  ])
    assert.deepEqual(allowedMethods("recurrences/" + route), ["POST"], route);
  assert.deepEqual(allowedMethods("recurrences/overview"), ["GET"]);
  assert.deepEqual(allowedMethods("routine/candidates"), ["GET"]);
});
