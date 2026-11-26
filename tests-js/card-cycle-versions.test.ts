import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  firstBill,
  planCycleSave,
  toCycleVersions,
  type CyclePlan,
  type VersionRow,
} from "../src/domain/card-cycle-versions.ts";
import { cardCompetence, billOf } from "../src/domain/card-competence.ts";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { readCycleVersions, saveCardCycle } from "../src/server/card-cycle.ts";
import { readCards } from "../src/server/cards.ts";

const row = (r: Omit<VersionRow, "id"> & { id?: string }): VersionRow => ({
  id: r.id ?? randomUUID(),
  ...r,
});
// Ciclo vigente: fecha dia 13, vence dia 20 do mesmo mês.
const current = row({
  id: "current",
  closing_day: 13,
  due_day: 20,
  due_month_offset: 0,
  valid_from: "2026-10-01",
  first_due_month: "2026-10",
});
const plan = (rows: VersionRow[], close: string, due: string, today: string) =>
  planCycleSave(rows, { close_date: close, due_date: due }, today);
const message = (p: CyclePlan) => ("message" in p ? p.message : "");
// [ação, início da versão, fechamento e vencimento da primeira fatura]
const summary = (p: CyclePlan): (string | undefined)[] => {
  if (!("row" in p)) return [p.action, message(p)];
  const bill = firstBill(p.row);
  return [p.action, p.row.valid_from, bill?.closeDate, bill?.dueDate];
};

test("primeira versão: hoje, ou depois do fechamento recente, nunca antes da fatura aberta", () => {
  assert.deepEqual(
    summary(plan([], "2026-10-25", "2026-11-03", "2026-10-20")),
    ["create", "2026-10-20", "2026-10-25", "2026-11-03"],
  );
  assert.deepEqual(
    summary(plan([], "2026-10-25", "2026-11-03", "2026-11-02")),
    ["create", "2026-10-26", "2026-11-25", "2026-12-03"],
  );
  // Fechamento digitado meses atrás não retroage: começa na fatura aberta.
  assert.deepEqual(
    summary(plan([], "2026-10-25", "2026-11-03", "2027-03-01")),
    ["create", "2027-02-26", "2027-03-25", "2027-04-03"],
  );
  const far = plan([], "2027-03-25", "2027-04-03", "2026-11-02");
  assert.equal(far.action, "error");
  assert.match(message(far), /62 dias/);
});

test("mudança no meio do ciclo vale depois do fechamento da fatura aberta", () => {
  assert.deepEqual(
    summary(plan([current], "2026-12-05", "2026-12-12", "2026-11-09")),
    ["schedule", "2026-11-14", "2026-12-05", "2026-12-12"],
  );
  const wrong = plan([current], "2026-11-05", "2026-11-12", "2026-11-09");
  assert.equal(wrong.action, "error");
  assert.match(message(wrong), /05\/12\/2026/);
});

test("edição no dia do fechamento e no dia seguinte", () => {
  assert.equal(
    summary(plan([current], "2026-12-05", "2026-12-12", "2026-11-13"))[1],
    "2026-11-14",
  );
  assert.equal(
    summary(plan([current], "2027-01-05", "2027-01-12", "2026-11-14"))[1],
    "2026-12-14",
  );
});

test("primeira fatura nova nunca cai no mês de vencimento da fatura aberta", () => {
  const at = (close: string, due: string) =>
    summary(plan([current], close, due, "2026-11-09"));
  assert.deepEqual(at("2026-12-15", "2026-12-22"), [
    "schedule",
    "2026-11-14",
    "2026-12-15",
    "2026-12-22",
  ]);
  assert.deepEqual(at("2026-12-13", "2026-12-25"), [
    "schedule",
    "2026-11-14",
    "2026-12-13",
    "2026-12-25",
  ]);
  assert.deepEqual(at("2026-11-25", "2026-12-05"), [
    "schedule",
    "2026-11-14",
    "2026-11-25",
    "2026-12-05",
  ]);
  assert.equal(
    plan([current], "2026-11-15", "2026-11-22", "2026-11-09").action,
    "error",
  );
  const late = row({
    closing_day: 20,
    due_day: 28,
    due_month_offset: 0,
    valid_from: "2026-10-01",
    first_due_month: "2026-10",
  });
  assert.deepEqual(
    summary(plan([late], "2026-12-10", "2027-01-02", "2026-11-09")),
    ["schedule", "2026-11-21", "2026-12-10", "2027-01-02"],
  );
});

test("duas edições antes da vigência; cancelar exige o fechamento atual", () => {
  const future = row({
    id: "future",
    closing_day: 5,
    due_day: 12,
    due_month_offset: 0,
    valid_from: "2026-11-14",
    first_due_month: "2026-12",
  });
  const both = [current, future];
  const replaced = plan(both, "2026-12-15", "2026-12-22", "2026-11-10");
  assert.equal(replaced.action, "replace_future");
  assert.equal("replaces" in replaced && replaced.replaces, "future");
  assert.equal(
    plan(both, "2026-12-05", "2026-12-12", "2026-11-10").action,
    "unchanged",
  );
  assert.deepEqual(plan(both, "2026-11-13", "2026-11-20", "2026-11-10"), {
    action: "cancel_future",
    replaces: "future",
  });
  // Reenviar o fechamento antigo que a tela mostrava não apaga o agendado.
  const stale = plan(both, "2026-10-13", "2026-10-20", "2026-11-10");
  assert.equal(stale.action, "error");
  assert.match(message(stale), /agendada a partir de 14\/11\/2026/);
  assert.equal(
    plan([current], "2026-11-13", "2026-11-20", "2026-11-10").action,
    "unchanged",
  );
});

test("só versão futura, sem vigente: a nova primeira versão toma o lugar", () => {
  const onlyFuture = row({
    id: "only-future",
    closing_day: 13,
    due_day: 20,
    due_month_offset: 0,
    valid_from: "2026-12-01",
    first_due_month: "2026-12",
  });
  const p = plan([onlyFuture], "2026-11-13", "2026-11-20", "2026-11-09");
  assert.equal(p.action, "replace_first");
  assert.equal("replaces" in p && p.replaces, "only-future");
  assert.equal(summary(p)[1], "2026-11-09");
});

test("primeira versão pode ser corrigida até a primeira fatura fechar, sem estourar a janela", () => {
  const seeded = row({
    id: "seeded",
    closing_day: 10,
    due_day: 20,
    due_month_offset: 0,
    valid_from: "2026-10-15",
    first_due_month: "2026-11",
  });
  assert.deepEqual(
    summary(plan([seeded], "2026-11-13", "2026-11-20", "2026-11-09")),
    ["replace_first", "2026-10-15", "2026-11-13", "2026-11-20"],
  );
  // Caso do review: a correção mantém o início e a primeira fatura passa a
  // ser a da regra corrigida que contém esse início (janela de um ciclo).
  const legacy = row({
    id: "legacy",
    closing_day: 25,
    due_day: 3,
    due_month_offset: 1,
    valid_from: "2026-10-26",
    first_due_month: "2026-12",
  });
  assert.deepEqual(
    summary(plan([legacy], "2026-12-28", "2027-01-05", "2026-11-01")),
    ["replace_first", "2026-10-26", "2026-10-28", "2026-11-05"],
  );
  assert.equal(
    plan([seeded], "2027-01-13", "2027-01-20", "2026-11-11").action,
    "schedule",
  );
});

test("virada de ano e meses curtos", () => {
  const dec = row({
    closing_day: 28,
    due_day: 5,
    due_month_offset: 1,
    valid_from: "2026-11-01",
    first_due_month: "2026-12",
  });
  assert.deepEqual(
    summary(plan([dec], "2027-02-10", "2027-02-20", "2026-12-20")),
    ["schedule", "2026-12-29", "2027-02-10", "2027-02-20"],
  );
  const last = row({
    closing_day: 31,
    due_day: 10,
    due_month_offset: 1,
    valid_from: "2026-01-01",
    first_due_month: "2026-02",
  });
  assert.deepEqual(
    summary(plan([last], "2026-04-15", "2026-04-25", "2026-02-15")),
    ["schedule", "2026-03-01", "2026-04-15", "2026-04-25"],
  );
});

test("versões adjacentes, competência de transição e histórico desconhecido", () => {
  const next = row({
    closing_day: 15,
    due_day: 22,
    due_month_offset: 0,
    valid_from: "2026-11-14",
    first_due_month: "2026-12",
  });
  const cycles = toCycleVersions([next, current]);
  assert.deepEqual(
    cycles.map((c) => [c.valid_from, c.valid_until]),
    [
      ["2026-10-01", "2026-11-13"],
      ["2026-11-14", null],
    ],
  );
  const month = (transactionDate: string, billDueDate?: string) =>
    cardCompetence({ transactionDate, billDueDate, cycles });
  assert.equal(month("2026-11-13").month, "2026-11");
  assert.equal(month("2026-11-14").month, "2026-12");
  assert.equal(month("2026-09-20").source, "unknown");
  assert.equal(month("2026-09-20", "2026-10-20").source, "bill");
});

test("ciclo 28/30 em fevereiro: planCycleSave não dá erro e a fatura não some", () => {
  // Antes, o primeiro cadastro de um ciclo 28/30 cujo HOJE caía em fevereiro
  // não bissexto dava "Ciclo inválido para o mês atual.", porque a fatura de
  // fevereiro (28/02 fecha e vence) sumia. Agora o vencimento vira o dia
  // seguinte ao fechamento (01/03) e o cadastro passa.
  assert.deepEqual(
    summary(plan([], "2026-01-28", "2026-01-30", "2026-02-10")),
    ["create", "2026-01-29", "2026-02-28", "2026-03-01"],
  );
});

async function family(
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
  const user = { userId, familyId, name: "Teste", email, role: "owner" };
  const card = async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)`,
      [id, familyId, userId],
    );
    return id;
  };
  return { user: user as Identity, userId, familyId, card };
}

test("gravação no banco: versões, espelho, auditoria, sobreposição e RLS", async () => {
  const db = await openDatabase();
  try {
    const { user, userId, familyId, card } = await family(
      db,
      "cycle-versions@example.invalid",
    );
    const acct = await card();
    const save = (close: string, due: string, today: string) =>
      saveCardCycle(
        db,
        user,
        { account_id: acct, close_date: close, due_date: due },
        { today },
      );
    const mirror = async () =>
      (
        await db.query<{ closing_day: number }>(
          "SELECT closing_day FROM card_cycles WHERE account_id=$1",
          [acct],
        )
      ).rows[0]?.closing_day;
    assert.equal(
      (await save("2026-10-25", "2026-11-03", "2026-10-20")).action,
      "create",
    );
    assert.equal(await mirror(), 25);
    const scheduled = await save("2027-01-05", "2027-01-15", "2026-11-09");
    assert.equal(scheduled.action, "schedule");
    assert.equal(scheduled.valid_from, "2026-11-26");
    assert.equal(scheduled.first_close_date, "2027-01-05");
    assert.equal(await mirror(), 25);
    assert.equal(
      (await save("2027-01-10", "2027-01-20", "2026-11-10")).action,
      "replace_future",
    );
    const versions = await asUser(db, userId, (tx) =>
      readCycleVersions(tx, familyId),
    );
    assert.deepEqual(
      versions.get(acct)?.map((v) => [v.valid_from, v.closing_day]),
      [
        ["2026-10-20", 25],
        ["2026-11-26", 10],
      ],
    );
    // Reenviar o ciclo antigo que a tela mostrava não cancela o agendado.
    await assert.rejects(
      save("2026-10-25", "2026-11-03", "2026-11-11"),
      /agendada/,
    );
    assert.equal(
      (await save("2026-11-25", "2026-12-03", "2026-11-11")).action,
      "cancel_future",
    );
    const actions = (
      await db.query<{ action: string }>(
        "SELECT metadata->>'plan_action' AS action FROM audit_events WHERE action='card.cycle' ORDER BY created_at",
      )
    ).rows.map((r) => r.action);
    assert.deepEqual(actions, [
      "create",
      "schedule",
      "replace_future",
      "cancel_future",
    ]);
    await assert.rejects(
      db.query(
        `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by) VALUES($1,$2,$3,5,15,0,'2026-10-20','2026-11-01',$4)`,
        [randomUUID(), familyId, acct, userId],
      ),
    );
    await assert.rejects(
      saveCardCycle(
        db,
        { ...user, role: "reader" },
        { account_id: acct, close_date: "2026-11-25", due_date: "2026-12-03" },
        { today: "2026-11-11" },
      ),
    );
    // Outra família não lê nem apaga as versões desta.
    const other = await family(db, "cycle-other@example.invalid");
    const seen = await asUser(db, other.userId, (tx) =>
      readCycleVersions(tx, other.familyId),
    );
    assert.equal(seen.size, 0);
    const deleted = await asUser(db, other.userId, (tx) =>
      tx.query("DELETE FROM card_cycle_versions WHERE account_id=$1", [acct]),
    );
    assert.equal(deleted.affectedRows ?? 0, 0);
    // A versão vigente não pode ser apagada nem pela própria família.
    const own = await asUser(db, userId, (tx) =>
      tx.query("DELETE FROM card_cycle_versions WHERE account_id=$1", [acct]),
    );
    assert.equal(own.affectedRows ?? 0, 0);
  } finally {
    await db.close();
  }
});

test("migração cria a primeira versão sem retroagir e não quebra em fim de mês", async () => {
  const db = await openDatabase();
  try {
    const { userId, familyId, card } = await family(
      db,
      "cycle-seed@example.invalid",
    );
    const [audited, legacy, feb, april] = [
      await card(),
      await card(),
      await card(),
      await card(),
    ];
    await db.query(
      `INSERT INTO card_cycles(household_id,account_id,closing_day,due_day,due_month_offset,effective_close_date,effective_due_date,created_by,updated_at) VALUES
       ($1,$2,13,20,0,'2026-11-13','2026-11-20',$3,'2026-11-05 12:00-03'),
       ($1,$4,25,3,1,'2026-10-25','2026-11-03',$3,'2026-11-02 12:00-03'),
       ($1,$5,28,30,0,'2026-01-28','2026-01-30',$3,'2026-02-01 12:00-03'),
       ($1,$6,30,31,0,'2026-03-30','2026-03-31',$3,'2026-04-02 12:00-03')`,
      [familyId, audited, userId, legacy, feb, april],
    );
    await db.query(
      `INSERT INTO audit_events(id,household_id,actor_id,action,entity_id,metadata,created_at) VALUES($1,$2,$3,'card.cycle',$4,'{"close_date":"2026-11-13","due_date":"2026-11-20"}','2026-10-20 15:00-03')`,
      [randomUUID(), familyId, userId, audited],
    );
    const sql = await readFile(
      "db/migrations/022_card_cycle_versions.sql",
      "utf8",
    );
    const seed = sql.slice(sql.indexOf("INSERT INTO card_cycle_versions("));
    await db.exec(seed);
    await db.exec(seed); // idempotente
    const seeded = (
      await db.query<{
        account_id: string;
        valid_from: string;
        first_due_month: string;
      }>(
        "SELECT account_id,valid_from::text,to_char(first_due_month,'YYYY-MM') AS first_due_month FROM card_cycle_versions",
      )
    ).rows;
    const of = (id: string) => {
      const r = seeded.find((s) => s.account_id === id);
      return r ? [r.valid_from, r.first_due_month] : null;
    };
    assert.equal(seeded.length, 4);
    assert.deepEqual(of(audited), ["2026-10-20", "2026-11"]);
    assert.deepEqual(of(legacy), ["2026-10-26", "2026-12"]);
    // Vencimento cortado no fim do mês vira fechamento + 1 dia: a fatura não
    // some e o cartão recebe versão. 28/30: saved_on 2026-02-01 cai na fatura
    // que fecha 28/02 (vence 01/03), início 29/01. 30/31: saved_on 2026-04-02
    // cai na fatura que fecha 30/04 (vence 01/05), início 31/03.
    assert.deepEqual(of(feb), ["2026-01-29", "2026-02"]);
    assert.deepEqual(of(april), ["2026-03-31", "2026-04"]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM card_cycles",
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await db.close();
  }
});

// readCards usa o HOJE real (SELECT ... America/Sao_Paulo), então as versões
// são inseridas com datas relativas a esse hoje (não a um today fixo, que
// divergiria do leitor e poderia cair em outro mês). As datas esperadas são
// derivadas das mesmas funções de domínio (billOf/readCycleVersions), para
// provar que readCards ligou cycle_schedule à versão vigente e à agendada.
test("readCards expõe cycle_schedule com a mudança agendada e o fechamento aberto", async () => {
  const db = await openDatabase();
  try {
    const { user, userId, familyId, card } = await family(
      db,
      "cycle-schedule@example.invalid",
    );
    const acct = await card();
    const today = (
      await db.query<{ today: string }>(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
      )
    ).rows[0].today;
    const month = today.slice(0, 7);
    // Vigente: começou bem antes de hoje; agendada: começa depois de hoje.
    await db.query(
      `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by) VALUES
       ($1,$2,$3,28,5,1,($6::date-interval '40 days')::date,date_trunc('month',$6::date-interval '40 days')::date,$5),
       ($4,$2,$3,15,22,0,($6::date+interval '25 days')::date,date_trunc('month',$6::date+interval '25 days')::date,$5)`,
      [randomUUID(), familyId, acct, randomUUID(), userId, today],
    );
    const versions = await asUser(db, userId, (tx) =>
      readCycleVersions(tx, familyId),
    ).then((m) => m.get(acct) ?? []);
    assert.equal(versions.length, 2);
    const active = versions.filter((v) => v.valid_from <= today).at(-1)!;
    const scheduledVersion = versions.find((v) => v.valid_from > today)!;
    const expectedOpen = billOf(today, active)!;
    const cards = await readCards(db, user, month);
    const mine = cards.find((c) => c.local_account_id === acct)!;
    assert.ok(mine.cycle_schedule, "cycle_schedule presente");
    assert.equal(mine.cycle_schedule.open_close_date, expectedOpen.closeDate);
    assert.equal(mine.cycle_schedule.open_due_date, expectedOpen.dueDate);
    const sched = mine.cycle_schedule.scheduled!;
    assert.ok(sched, "mudança agendada presente");
    assert.equal(sched.valid_from, scheduledVersion.valid_from);
    assert.equal(sched.closing_day, 15);
    assert.equal(sched.due_day, 22);
    assert.equal(sched.first_close_date !== null, true);
    assert.equal(sched.first_due_date !== null, true);
  } finally {
    await db.close();
  }
});
