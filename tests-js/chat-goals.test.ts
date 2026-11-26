import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { listGoals } from "../src/server/reserves.ts";
import { saveGoalLocation } from "../src/server/reserve-goal.ts";
import {
  chatIntent,
  proposeAction,
  resolveAction,
  type ChatCatalog,
} from "../src/server/chat-actions.ts";

async function identityOf(
  db: Awaited<ReturnType<typeof openDatabase>>,
  email: string,
): Promise<Identity> {
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
  return { userId, familyId, name: "Pessoa", email, role: "owner" };
}

test("chat goal actions: preview without writing, confirm once, guard rails", async () => {
  const db = await openDatabase();
  const user = await identityOf(db, "goals@example.invalid");
  const other = await identityOf(db, "goals2@example.invalid");
  const reader: Identity = { ...user, role: "reader" };

  const catalogFor = async (): Promise<ChatCatalog> => ({
    items: [],
    accounts: [],
    categories: [],
    goals: (await listGoals(db, user))
      .filter((g) => g.status === "active")
      .map((g) => ({
        id: g.id,
        name: g.name,
        location: g.location,
        status: g.status,
        target_cents: g.target_cents,
        saved_cents: g.saved_cents,
      })),
  });
  const propose = async (raw: unknown, u = user) =>
    proposeAction(db, u, raw, await catalogFor(), "2026-10", "BRL");
  const resolve = (
    id: string,
    decision: "confirm" | "cancel" = "confirm",
    u = user,
  ) => resolveAction(db, u, { id, decision });
  const goalCount = async (name: string) =>
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM goals WHERE household_id=$1 AND name=$2",
        [user.familyId, name],
      )
    ).rows[0].n;

  // (a) goal_create: prévia não grava; confirmação grava uma linha; dupla confirmação grava uma só.
  const create = {
    type: "goal_create",
    name: "Viagem",
    target_cents: "500000",
    deadline_month: "2027-06",
  };
  const preview = await propose(create);
  assert.equal(preview.title, "Criar objetivo");
  assert.equal(await goalCount("Viagem"), 0);
  const settled = await Promise.allSettled([
    resolve(preview.id),
    resolve(preview.id),
  ]);
  assert.equal(settled.filter((s) => s.status === "fulfilled").length, 2);
  assert.equal(await goalCount("Viagem"), 1);

  // (b) nome duplicado é rejeitado já na prévia (sem diferenciar maiúsculas).
  await assert.rejects(
    propose({ ...create, name: "viagem" }),
    /Já existe um objetivo/,
  );

  // (c) goal_contribute: depósito confirmado sobe o saldo.
  const goal = (await listGoals(db, user)).find((g) => g.name === "Viagem")!;
  await assert.rejects(
    // (d) sem local do dinheiro, rejeitado na prévia.
    propose({
      type: "goal_contribute",
      target: "g0",
      kind: "deposit",
      amount_cents: "5000",
      date: "2026-10-05",
    }),
    /onde esse dinheiro fica/,
  );
  await saveGoalLocation(db, user, {
    goal_id: goal.id,
    location: "same_account",
    version: goal.version,
  });
  const deposit = {
    type: "goal_contribute",
    target: "g0",
    kind: "deposit",
    amount_cents: "5000",
    date: "2026-10-05",
  };
  const depositPreview = await propose(deposit);
  assert.equal(depositPreview.title, "Guardar em objetivo");
  await resolve(depositPreview.id);
  assert.equal(
    (await listGoals(db, user)).find((g) => g.id === goal.id)!.saved_cents,
    "5000",
  );

  // (f) movimento igual é rejeitado, sem duplicar.
  const again = await propose(deposit);
  await assert.rejects(resolve(again.id), /movimento igual/);
  assert.equal(
    (await listGoals(db, user)).find((g) => g.id === goal.id)!.saved_cents,
    "5000",
  );

  // (e) retirada maior que o saldo é rejeitada na confirmação.
  const withdrawal = await propose({
    ...deposit,
    kind: "withdrawal",
    amount_cents: "999900",
  });
  await assert.rejects(resolve(withdrawal.id), /maior que o saldo/);
  assert.equal(
    (await listGoals(db, user)).find((g) => g.id === goal.id)!.saved_cents,
    "5000",
  );

  // (g) leitor não propõe; outra família não confirma a prévia alheia.
  await assert.rejects(propose(create, reader), /leitura/);
  const mine = await propose({ ...create, name: "Reforma" });
  await assert.rejects(resolve(mine.id, "confirm", other), /disponível/);
  assert.equal(await goalCount("Reforma"), 0);
  await assert.rejects(resolve(mine.id, "confirm", reader), /leitura/);

  // (h) campo extra é rejeitado pelo schema strict.
  assert.equal(
    chatIntent.safeParse({
      ...deposit,
      bank_transaction_id: "5f7d3b9e-52b5-4a5f-9c6e-0d6b2f6a7a11",
    }).success,
    false,
  );
  assert.equal(
    chatIntent.safeParse({ ...create, plan_id: "x" }).success,
    false,
  );
});
