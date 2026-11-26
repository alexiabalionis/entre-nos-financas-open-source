import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { sendDueReminders } from "../src/server/notifications.ts";

type Db = Awaited<ReturnType<typeof openDatabase>>;

const BODY = {
  items: "Há compromissos perto do vencimento no nosso mês.",
  card: "A fatura do cartão vence em breve. Vale conferir no nosso mês.",
  goal: "Um objetivo de vocês chega ao prazo em breve. Vale conferir quanto falta.",
};

async function setup(db: Db, email: string) {
  const userId = await createFamily(db, {
    name: "Pessoa fictícia",
    familyName: "Teste",
    email,
    password: "SenhaFicticia!2026",
  });
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user: Identity = {
    userId,
    familyId,
    name: "Pessoa",
    email,
    role: "owner",
  };
  await db.query(
    "INSERT INTO push_subscriptions(id,household_id,user_id,endpoint,keys,enabled) VALUES($1,$2,$3,$4,$5,true)",
    [
      randomUUID(),
      familyId,
      userId,
      "https://fcm.googleapis.com/fcm/send/xyz",
      JSON.stringify({ p256dh: "p", auth: "a" }),
    ],
  );
  const today = (
    await db.query<{ d: string }>(
      "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d",
    )
  ).rows[0].d;
  return { user, today };
}

async function captureSends(run: () => Promise<void>) {
  const original = webpush.sendNotification;
  const bodies: string[] = [];
  webpush.sendNotification = (async (_sub: unknown, payload: unknown) => {
    bodies.push((JSON.parse(String(payload)) as { body: string }).body);
    return { statusCode: 201, body: "", headers: {} };
  }) as unknown as typeof webpush.sendNotification;
  try {
    await run();
  } finally {
    webpush.sendNotification = original;
  }
  return bodies;
}

const addItem = (db: Db, user: Identity, today: string) =>
  db.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,created_by)
     VALUES($1,$2,date_trunc('month',$3::date)::date,'Conta fictícia','expense','BRL',10000,$3::date,$4)`,
    [randomUUID(), user.familyId, today, user.userId],
  );
const addGoal = (user: Identity, db: Db, today: string) =>
  createGoal(db, user, {
    name: "Viagem",
    target: "1.000,00",
    deadline_month: today.slice(0, 7),
  });

test("lembrete: item vencendo usa o corpo de 'items'", async () => {
  const db = await openDatabase();
  const { user, today } = await setup(db, "notif-items@example.invalid");
  await addItem(db, user, today);
  let result = { sent: 0, failed: 0 };
  const bodies = await captureSends(async () => {
    result = await sendDueReminders(db);
  });
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.deepEqual(bodies, [BODY.items]);
});

test("lembrete: só meta com prazo no mês e saldo menor usa 'goal_deadline'", async () => {
  const db = await openDatabase();
  const { user, today } = await setup(db, "notif-goal@example.invalid");
  await addGoal(user, db, today);
  const bodies = await captureSends(async () => {
    await sendDueReminders(db);
  });
  assert.deepEqual(bodies, [BODY.goal]);
});

test("lembrete: sem nada pendente não envia", async () => {
  const db = await openDatabase();
  await setup(db, "notif-none@example.invalid");
  let result = { sent: -1, failed: -1 };
  const bodies = await captureSends(async () => {
    result = await sendDueReminders(db);
  });
  assert.deepEqual(result, { sent: 0, failed: 0 });
  assert.deepEqual(bodies, []);
});

test("lembrete: item vencendo tem prioridade sobre meta no prazo", async () => {
  const db = await openDatabase();
  const { user, today } = await setup(db, "notif-prio@example.invalid");
  await addItem(db, user, today);
  await addGoal(user, db, today);
  const bodies = await captureSends(async () => {
    await sendDueReminders(db);
  });
  assert.deepEqual(bodies, [BODY.items]);
});

test("lembrete: fatura manual vencendo usa o corpo de cartão", async () => {
  const db = await openDatabase();
  const { user, today } = await setup(db, "notif-card@example.invalid");
  const account = randomUUID();
  await db.query(
    `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão teste','Teste','BRL','card',$3)`,
    [account, user.familyId, user.userId],
  );
  await db.query(
    `INSERT INTO manual_card_bills(household_id,account_id,month,amount_cents,due_date,paid,updated_by)
     VALUES($1,$2,date_trunc('month',$3::date)::date,50000,$3::date,false,$4)`,
    [user.familyId, account, today, user.userId],
  );
  const bodies = await captureSends(async () => {
    await sendDueReminders(db);
  });
  assert.deepEqual(bodies, [BODY.card]);
});

test("lembrete: segunda chamada no mesmo dia não reenvia", async () => {
  const db = await openDatabase();
  const { user, today } = await setup(db, "notif-throttle@example.invalid");
  await addItem(db, user, today);
  const first = await captureSends(async () => {
    await sendDueReminders(db);
  });
  const second = await captureSends(async () => {
    await sendDueReminders(db);
  });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});
