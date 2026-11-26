import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { createFamily, issueSession, identity } from "../src/server/auth.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import { readRoutine, saveItem } from "../src/server/routine.ts";

test("readRoutine devolve a recorrência do item de série e null nos demais", async () => {
  const db = await openDatabase();
  try {
    const email = "routine-recurrence@example.invalid";
    await createFamily(db, {
      email,
      name: "serie",
      password: "SenhaFicticia!2026",
      familyName: "serie",
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
    const created = await createRecurrence(db, user, {
      purpose: "expense",
      label: "Condomínio",
      category_id: category,
      expected_cents: 61200,
      frequency: "month",
      start_date: "2026-11-15",
      today: "2026-11-09",
    });
    await saveItem(db, user, {
      month: "2026-11",
      label: "Mercado avulso",
      purpose: "expense",
      currency: "BRL",
      amount: "50,00",
      due_date: null,
      category_id: null,
      notes: "",
    });

    const { items } = await readRoutine(db, user, "2026-11");
    const series = items.find((i) => i.label === "Condomínio")!;
    assert.deepEqual(series.recurrence, {
      id: created.recurrence_id,
      frequency: "month",
      every: 1,
      start_date: "2026-11-15",
      end_date: null,
      occurrence_date: "2026-11-15",
      card_name: null,
    });
    assert.equal(items.find((i) => i.label === "Mercado avulso")!.recurrence, null);
  } finally {
    await db.close();
  }
});
