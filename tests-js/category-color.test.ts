import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, asUser } from "../src/server/db.ts";
import { createFamily, identity, issueSession, type Identity } from "../src/server/auth.ts";

// Migration 024: cada categoria tem cor fixa (color_index 0..11), atribuída na
// criação pela cor menos usada da família, sem repetir até a paleta acabar.
let db: PGlite;
let a: Identity;
let b: Identity;

async function colors(user: Identity) {
  return asUser(db, user.userId, async (tx) =>
    (
      await tx.query<{ name: string; color_index: number | null }>(
        "SELECT name,color_index FROM categories WHERE household_id=$1 ORDER BY name",
        [user.familyId],
      )
    ).rows,
  );
}

async function insert(user: Identity, name: string) {
  await asUser(db, user.userId, (tx) =>
    tx.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,$3)", [
      randomUUID(),
      user.familyId,
      name,
    ]),
  );
}

before(async () => {
  db = await openDatabase();
  for (const [email, name] of [
    ["cor-a@example.invalid", "Família cor A"],
    ["cor-b@example.invalid", "Família cor B"],
  ])
    await createFamily(db, {
      email,
      name,
      password: "SenhaFicticia!2026",
      familyName: name,
    });
  const users = (
    await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email LIKE 'cor-%' ORDER BY email",
    )
  ).rows;
  a = (await identity(db, await issueSession(db, users[0].id)))!;
  b = (await identity(db, await issueSession(db, users[1].id)))!;
});

after(async () => {
  await db.close();
});

// Equilíbrio: nenhuma cor é usada mais de 1 vez a mais que outra. Com N
// categorias, isso garante zero repetição enquanto N <= 12.
function spread(rows: { color_index: number | null }[]) {
  const counts = [...Array(12).keys()].map(
    (i) => rows.filter((r) => r.color_index === i).length,
  );
  return Math.max(...counts) - Math.min(...counts);
}

test("categorias padrão do cadastro já nascem com cor, equilibrada", async () => {
  const rows = await colors(a);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.color_index !== null && r.color_index >= 0 && r.color_index <= 11));
  assert.ok(spread(rows) <= 1, "sem repetir antes de usar todas as 12");
});

test("categoria nova pega a cor menos usada e mantém o equilíbrio", async () => {
  for (let i = 0; i < 5; i++) {
    await insert(a, `Categoria nova ${i}`);
    assert.ok(spread(await colors(a)) <= 1);
  }
});

test("a contagem é por família: criar em A não mexe no equilíbrio de B", async () => {
  const before = await colors(b);
  for (let i = 0; i < 3; i++) await insert(a, `Só de A ${i}`);
  await insert(b, "Primeira de B");
  const after = await colors(b);
  assert.equal(after.length, before.length + 1);
  assert.ok(spread(after) <= 1);
});

test("cor informada explicitamente é respeitada", async () => {
  await asUser(db, a.userId, (tx) =>
    tx.query(
      "INSERT INTO categories(id,household_id,name,color_index) VALUES($1,$2,'Escolhida',7)",
      [randomUUID(), a.familyId],
    ),
  );
  const row = (await colors(a)).find((r) => r.name === "Escolhida");
  assert.equal(row?.color_index, 7);
});
