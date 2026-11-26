import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity, type Identity } from "../src/server/auth.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { saveRecurrenceDecision } from "../src/server/recurrences.ts";
import { applyFromDate, createRecurrence, endRecurrence, previewFromDate } from "../src/server/recurrence-series.ts";
import { moveCompetence } from "../src/server/recurrence-occurrence.ts";
import { convertLegacyItem } from "../src/server/recurrence-convert.ts";
import { readFixedOverview } from "../src/server/recurrence-overview.ts";

const TODAY = "2026-11-09";
const NOV = { month: "2026-11" };

async function family(db: PGlite, tag: string) {
  const email = `ov-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name='Transporte'", [user.familyId])).rows[0].id;
  await db.query("UPDATE categories SET fixed=false,essential=false WHERE id=$1", [category]);
  const bank = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3)",
    [bank, user.familyId, userId],
  );
  const event = (date: string, cents: number, description: string) =>
    asUser(db, userId, async (tx) => {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,created_by)
         VALUES($1,$2,$3,'expense',$4,$5,$5,$6,'BRL',$7,$8)`,
        [id, user.familyId, bank, date, description, -cents, category, userId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,'expense','BRL',$7,$8)`,
        [randomUUID(), user.familyId, id, bank, randomUUID(), -cents, cents, date],
      );
      return id;
    });
  const make = (over: Record<string, unknown> = {}) =>
    createRecurrence(db, user, { purpose: "expense", label: "Aluguel", category_id: category, expected_cents: 100000, frequency: "month", start_date: "2026-11-05", today: TODAY, ...over });
  const legacy = async (label: string, over: { cost_type?: string | null; derived?: boolean } = {}) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,created_by,cost_type,derived)
       VALUES($1,$2,'2026-11-01',$3,'expense','BRL',45000,$4,'2026-11-20',$5,$6,$7)`,
      [id, user.familyId, label, category, userId, over.cost_type === undefined ? "fixed" : over.cost_type, over.derived ?? false],
    );
    return id;
  };
  const view = (u: Identity = user, q: { month: string } = NOV) => readFixedOverview(db, u, q, { today: TODAY });
  const itemOf = async (id: string) => (await db.query<{ version: number; planned_cents: string; status: string; month: string }>("SELECT version,planned_cents::text,status,month::text FROM monthly_items WHERE id=$1", [id])).rows[0];
  return { user, category, bank, event, make, legacy, view, itemOf };
}

test("total, ativas, semanal com 4 e 5 ocorrências, próxima data e conciliada pelo pago", async () => {
  const db = await openDatabase();
  try {
    const { user, make, view, event } = await family(db, "total");
    await make();
    await make({ label: "Feira", expected_cents: 20000, frequency: "week", start_date: "2026-11-04" });
    const nov = await view();
    assert.equal(nov.total_cents, "180000");
    assert.equal(nov.active, 2);
    assert.deepEqual(nov.series.map((s) => s.label), ["Aluguel", "Feira"]);
    const feira = nov.series[1];
    assert.equal(feira.occurrences.length, 4);
    assert.equal(feira.month_cents, "80000");
    assert.equal(feira.next_date, "2026-11-11");
    assert.equal(nov.series[0].next_date, "2026-12-05");
    assert.equal((await view(user, { month: "2026-12" })).series[1].occurrences.length, 5);

    const eventId = await event("2026-11-04", 25000, "FEIRA");
    await db.query("UPDATE monthly_items SET status='done', paid_cents=25000, event_id=$1 WHERE id=$2", [eventId, feira.occurrences[0].item_id]);
    await db.query("UPDATE monthly_items SET archived=true WHERE id=$1", [feira.occurrences[1].item_id]);
    const after = await view();
    assert.equal(after.total_cents, String(180000 + 5000 - 20000));
    assert.equal(after.series[1].occurrences[1].archived, true);
  } finally {
    await db.close();
  }
});

test("editar a partir de uma data: só a versão nova aparece, sem 'pulada', e a paga continua", async () => {
  const db = await openDatabase();
  try {
    const { user, make, view, event } = await family(db, "edit");
    const { recurrence_id } = await make({ label: "Faxina", expected_cents: 20000, frequency: "week", start_date: "2026-11-04" });
    const before = (await view()).series[0];
    const eventId = await event("2026-11-04", 20000, "FAXINA");
    await db.query("UPDATE monthly_items SET status='done', paid_cents=20000, event_id=$1 WHERE id=$2", [eventId, before.occurrences[0].item_id]);
    const { groups } = await previewFromDate(db, user, { recurrence_id, from: "2026-11-10" });
    const versions = Object.fromEntries([...groups.replaced, ...groups.edited, ...groups.preserved].map((e) => [e.monthly_item_id, e.version]));
    await applyFromDate(db, user, { recurrence_id, from: "2026-11-10", today: TODAY, changes: { expected_cents: 25000 }, decisions: {}, versions });
    const after = await view();
    assert.deepEqual(after.series.map((s) => s.label), ["Faxina"]);
    const faxina = after.series[0];
    assert.notEqual(faxina.id, recurrence_id);
    assert.equal(faxina.occurrences.some((o) => o.archived), false);
    assert.equal(faxina.occurrences.length, 4);
    assert.equal(faxina.month_cents, String(20000 + 3 * 25000));
    assert.equal(after.total_cents, faxina.month_cents);
    // Próxima aberta da versão nova, para "Editar" quando o mês da tela não tem a conta.
    assert.equal(faxina.next_item?.month, "2026-11");
    assert.ok(faxina.occurrences.some((o) => o.item_id === faxina.next_item?.item_id));
  } finally {
    await db.close();
  }
});

test("voltar a data numa conta já editada: vale até o fim da versão anterior, sem cópia", async () => {
  const db = await openDatabase();
  try {
    const { user, make, view } = await family(db, "back");
    const versionsOf = async (recurrence_id: string, from: string) => {
      const { groups } = await previewFromDate(db, user, { recurrence_id, from });
      return Object.fromEntries([...groups.replaced, ...groups.edited, ...groups.preserved].map((e) => [e.monthly_item_id, e.version]));
    };
    const apply = async (recurrence_id: string, from: string, start_date: string) =>
      applyFromDate(db, user, { recurrence_id, from, today: TODAY, changes: { start_date }, decisions: {}, versions: await versionsOf(recurrence_id, from) });
    const { recurrence_id: a } = await make({ label: "Kiro", start_date: "2026-11-05" });
    // Primeira edição: do dia 5 para o 26 (a de novembro sai, a nova é 26/11).
    const { recurrence_id: b } = await apply(a, "2026-11-05", "2026-11-26");
    // Antes do fim da versão anterior (04/11): recusa.
    await assert.rejects(() => previewFromDate(db, user, { recurrence_id: b, from: "2026-11-01" }), /Dá para voltar até 05\/11\/2026/);
    // Voltar para o dia 5: a de 26/11 sai e a de 05/11 volta, uma só.
    await apply(b, "2026-11-05", "2026-11-05");
    const kiro = (await view()).series;
    assert.equal(kiro.length, 1);
    assert.deepEqual(kiro[0].occurrences.map((o) => [o.occurrence_date, o.archived]), [["2026-11-05", false]]);
    assert.equal(kiro[0].month_cents, "100000");
  } finally {
    await db.close();
  }
});

test("sugestão: some com 'não' e com série de mesmo texto; 'sim' marca previously_confirmed", async () => {
  const db = await openDatabase();
  try {
    const { user, category, view, event, make } = await family(db, "sugestao");
    for (const d of ["2026-08-04", "2026-09-04", "2026-10-04"]) await event(d, 140000, "FINANCIAMENTO CARRO");
    const first = (await view()).suggestions;
    assert.equal(first.length, 1);
    assert.equal(first[0].previously_confirmed, false);
    assert.equal(first[0].category_id, category);
    assert.equal(first[0].account_id, null);
    const key = first[0].merchant_key;
    const decide = (decision: "confirm" | "dismiss") => saveRecurrenceDecision(db, user, { scope: "cash", merchant_key: key, decision });
    await decide("confirm");
    assert.equal((await view()).suggestions[0].previously_confirmed, true);
    await decide("dismiss");
    assert.equal((await view()).suggestions.length, 0);
    await decide("confirm");
    await make({ label: "Carro", match_text: key, start_date: "2026-11-04", expected_cents: 140000 });
    assert.equal((await view()).suggestions.length, 0);
  } finally {
    await db.close();
  }
});

test("excluir conta fixa sem nada pago tira de todos os meses; com conta paga, recusa", async () => {
  const db = await openDatabase();
  try {
    const { user, view, make } = await family(db, "excluir");
    const { recurrence_id } = await make({ label: "Itaushop", start_date: "2026-11-07", expected_cents: 22993 });
    const { deleteRecurrence } = await import("../src/server/recurrence-delete.ts");
    await deleteRecurrence(db, user, { recurrence_id });
    const after = await view();
    assert.equal(after.series.some((s) => s.label === "Itaushop"), false);
    const open = await db.query("SELECT 1 FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id WHERE o.recurrence_id=$1 AND NOT i.archived", [recurrence_id]);
    assert.equal(open.rows.length, 0);
    const { recurrence_id: paid } = await make({ label: "Aluguel", start_date: "2026-11-05" });
    const item = (await view()).series.find((s) => s.label === "Aluguel")!.occurrences[0].item_id;
    await db.query("UPDATE monthly_items SET status='done', paid_cents=100000 WHERE id=$1", [item]);
    await assert.rejects(() => deleteRecurrence(db, user, { recurrence_id: paid }), /Use Encerrar/);
  } finally {
    await db.close();
  }
});

test("encerrar na véspera do início remove a conta fixa da lista e de todos os meses", async () => {
  const db = await openDatabase();
  try {
    const { user, view, make } = await family(db, "remover");
    const { recurrence_id } = await make({ label: "Itaushop", start_date: "2026-12-07", expected_cents: 22993 });
    const preview = await previewFromDate(db, user, { recurrence_id, from: "2026-12-07" });
    const versions = Object.fromEntries(
      [...preview.groups.replaced, ...preview.groups.edited, ...preview.groups.preserved].map((e) => [e.monthly_item_id, e.version]),
    );
    await endRecurrence(db, user, { recurrence_id, from: "2026-12-07", decisions: {}, versions });
    const after = await view();
    assert.equal(after.series.some((s) => s.label === "Itaushop"), false);
    assert.equal(after.active, 0);
  } finally {
    await db.close();
  }
});

test("sugestão some com conta fixa encerrada de mesmo nome, mesmo com '05/12' no nome", async () => {
  const db = await openDatabase();
  try {
    const { view, event, make } = await family(db, "sugestao-encerrada");
    for (const d of ["2026-08-07", "2026-09-07", "2026-10-07"]) await event(d, 22238, "ZURICH SEGUROS 05/12");
    assert.equal((await view()).suggestions.length, 1);
    await make({ label: "ZURICH SEGUROS 05/12", start_date: "2026-08-07", expected_cents: 22238, end_date: "2026-10-31" });
    assert.equal((await view()).suggestions.length, 0);
  } finally {
    await db.close();
  }
});

test("legado lista só fixa avulsa; converter reaproveita o item e gera as futuras", async () => {
  const db = await openDatabase();
  try {
    const { user, make, legacy, view, itemOf } = await family(db, "legado");
    const fixed = await legacy("Internet");
    await legacy("Mercado", { cost_type: "variable" });
    await legacy("Calculada", { derived: true });
    await make();
    assert.deepEqual((await view()).legacy.map((l) => l.item_id), [fixed]);
    const before = await itemOf(fixed);

    await assert.rejects(convertLegacyItem(db, user, { item_id: fixed, version: before.version + 1, frequency: "month", today: TODAY }), /mudou/);
    const seriesItem = (await view()).series[0].occurrences[0].item_id;
    await assert.rejects(convertLegacyItem(db, user, { item_id: seriesItem, version: 1, frequency: "month", today: TODAY }), /recorrência/);

    const made = await convertLegacyItem(db, user, { item_id: fixed, version: before.version, frequency: "month", today: TODAY });
    assert.equal(made.created, 2, "20/12 e 20/01 até o horizonte");
    assert.deepEqual(await itemOf(fixed), before, "item reaproveitado sem mudar valor, status nem versão");
    const after = await view();
    assert.equal(after.legacy.length, 0);
    const internet = after.series.find((s) => s.label === "Internet")!;
    assert.equal(internet.start_date, "2026-11-20");
    assert.equal(internet.occurrences[0].item_id, fixed);
    assert.equal(after.total_cents, "145000");
    await assert.rejects(convertLegacyItem(db, user, { item_id: fixed, version: before.version, frequency: "month" }), /recorrência/);
  } finally {
    await db.close();
  }
});

test("ciclo do cartão mudou: revisão lista só aberta, sem pagamento; mover tira da lista", async () => {
  const db = await openDatabase();
  try {
    const { user, make, view } = await family(db, "ciclo");
    const card = randomUUID();
    await db.query("INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)", [card, user.familyId, user.userId]);
    await make({ label: "Streaming", account_id: card, start_date: "2026-11-28", expected_cents: 3990 });
    assert.deepEqual((await view()).card_cycle_review, []);

    await saveCardCycle(db, user, { account_id: card, close_date: "2026-10-25", due_date: "2026-11-10" }, { today: "2026-10-01" });
    const review = (await view()).card_cycle_review;
    assert.equal(review.length, 3);
    assert.ok(review.every((r) => r.current_month !== r.suggested_month && r.label === "Streaming"));

    await db.query("UPDATE monthly_items SET status='done', paid_cents=3990, version=version+1 WHERE id=$1", [review[0].item_id]);
    assert.equal((await view()).card_cycle_review.length, 2);

    const next = (await view()).card_cycle_review[0];
    await moveCompetence(db, user, { item_id: next.item_id, version: next.version, month: next.suggested_month, due_date: next.suggested_due_date });
    assert.equal((await view()).card_cycle_review.length, 1);
  } finally {
    await db.close();
  }
});

test("leitor lê a visão, mas não converte e a leitura não grava", async () => {
  const db = await openDatabase();
  try {
    const { user, legacy, view } = await family(db, "leitor");
    const fixed = await legacy("Internet");
    const reader: Identity = { ...user, role: "reader" };
    const count = async () => (await db.query<{ n: number }>("SELECT (SELECT count(*) FROM monthly_items)::int + (SELECT count(*) FROM recurrences)::int AS n")).rows[0].n;
    const before = await count();
    assert.equal((await view(reader)).legacy.length, 1);
    assert.equal(await count(), before);
    await assert.rejects(convertLegacyItem(db, reader, { item_id: fixed, version: 1, frequency: "month" }), /leitura/);
    await assert.rejects(readFixedOverview(db, user, { month: "2026-13" }));
  } finally {
    await db.close();
  }
});
