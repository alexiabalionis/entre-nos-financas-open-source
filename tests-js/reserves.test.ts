import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openDatabase, asUser, type Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import {
  ensureFirstGoal,
  listGoals,
  savePlan,
  saveEverydayWeekly,
} from "../src/server/reserves.ts";
import { addMovement, voidMovement } from "../src/server/reserve-movements.ts";
import {
  createGoal,
  saveGoalLocation,
  updateGoal,
} from "../src/server/reserve-goal.ts";
import { UserError } from "../src/server/imports.ts";
import {
  cycleStatus,
  goalBalance,
  type ReserveMovement,
} from "../src/domain/reserve.ts";

async function family(db: Database, tag: string): Promise<Identity> {
  const email = `${tag}@example.invalid`;
  const userId = await createFamily(db, {
    name: tag,
    familyName: "Casa " + tag,
    email,
    password: "Ficticia!2026abcd",
  });
  const { household_id } = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  return { userId, familyId: household_id, name: tag, email, role: "owner" };
}
async function firstGoal(db: Database, u: Identity): Promise<string> {
  await asUser(db, u.userId, (tx) => ensureFirstGoal(tx, { user: u }));
  return (await listGoals(db, u))[0].id;
}
async function bankLine(db: Database, u: Identity, amount: number) {
  const local = randomUUID();
  const connection = randomUUID();
  const bankAccount = randomUUID();
  const id = randomUUID();
  await asUser(db, u.userId, async (tx) => {
    await tx.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',$3)",
      [local, u.familyId, u.userId],
    );
    await tx.query(
      "INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')",
      [u.familyId, u.userId],
    );
    await tx.query(
      "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2026-01-01')",
      [connection, u.familyId, u.userId, randomUUID()],
    );
    await tx.query(
      "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'C','BRL','BANK',$5)",
      [bankAccount, u.familyId, connection, randomUUID(), local],
    );
    await tx.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run)
       VALUES($1,$2,$3,$4,$5,'2026-11-05','Reserva',$6,'BRL','POSTED','synthetic',$7)`,
      [id, u.familyId, bankAccount, local, randomUUID(), amount, randomUUID()],
    );
  });
  return id;
}

test("migration 025 roda duas vezes e ensureFirstGoal é idempotente", async () => {
  const db = await openDatabase();
  try {
    await db.exec(
      await readFile("db/migrations/025_goals_reserves.sql", "utf8"),
    );
    const u = await family(db, "mig");
    await firstGoal(db, u);
    await asUser(db, u.userId, (tx) => ensureFirstGoal(tx, { user: u }));
    const goals = await listGoals(db, u);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].name, "Primeira reserva");
    assert.equal(goals[0].target_cents, "50000");
  } finally {
    await db.close();
  }
});

test("plano: cria, substitui (só um vigente) e aceita zero", async () => {
  const db = await openDatabase();
  try {
    const u = await family(db, "plan");
    const goal = await firstGoal(db, u);
    const first = await savePlan(db, u, {
      goal_id: goal,
      month: "2026-11",
      planned: "100,00",
    });
    await assert.rejects(
      savePlan(db, u, {
        goal_id: goal,
        month: "2026-11",
        planned: "50,00",
        version_of: randomUUID(),
      }),
      /mudou no outro aparelho/,
    );
    const second = await savePlan(db, u, {
      goal_id: goal,
      month: "2026-11",
      planned: "0,00",
      version_of: first.id,
    });
    const rows = (
      await asUser(db, u.userId, (tx) =>
        tx.query<{ id: string; superseded_by: string | null; planned: string }>(
          "SELECT id,superseded_by,planned_cents::text AS planned FROM reserve_plans ORDER BY created_at",
        ),
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.id === first.id)!.superseded_by, second.id);
    assert.equal(rows.filter((r) => r.superseded_by === null).length, 1);
    assert.equal(rows.find((r) => r.id === second.id)!.planned, "0");
  } finally {
    await db.close();
  }
});

test("movimentos: parcial e completo, retirada limitada, void e linha do banco única", async () => {
  const db = await openDatabase();
  try {
    const u = await family(db, "mov");
    const goal = await firstGoal(db, u);
    await assert.rejects(
      addMovement(db, u, {
        goal_id: goal,
        kind: "deposit",
        amount: "10,00",
        date: "2026-11-06",
      }),
      /diga onde esse dinheiro fica/,
    );
    await saveGoalLocation(db, u, {
      goal_id: goal,
      location: "same_account",
      version: 1,
    });
    const plan = await savePlan(db, u, {
      goal_id: goal,
      month: "2026-11",
      planned: "100,00",
    });
    const status = async () => {
      const rows = (
        await asUser(db, u.userId, (tx) =>
          tx.query<{ cents: string; voided: boolean }>(
            "SELECT cents::text,voided_at IS NOT NULL AS voided FROM reserve_movements WHERE plan_id=$1",
            [plan.id],
          ),
        )
      ).rows;
      return cycleStatus({
        plan: { planned_cents: 10000n },
        movements: rows.map((r) => ({
          kind: "deposit",
          cents: BigInt(r.cents),
          bank_transaction_id: null,
          voided: r.voided,
        })),
      });
    };
    const base = { goal_id: goal, plan_id: plan.id, kind: "deposit" as const };
    const a = await addMovement(db, u, {
      ...base,
      amount: "40,00",
      date: "2026-11-06",
    });
    assert.equal(await status(), "partial");
    await addMovement(db, u, { ...base, amount: "60,00", date: "2026-11-07" });
    assert.equal(await status(), "done");
    await assert.rejects(
      addMovement(db, u, {
        goal_id: goal,
        kind: "withdrawal",
        amount: "100,01",
        date: "2026-11-08",
      }),
      /maior que o saldo/,
    );
    await voidMovement(db, u, { id: a.id, reason: "valor errado" });
    assert.equal((await listGoals(db, u))[0].saved_cents, "6000");
    assert.equal(await status(), "partial");

    const line = await bankLine(db, u, -2500);
    const withLine = {
      goal_id: goal,
      kind: "deposit" as const,
      amount: "25,00",
      date: "2026-11-05",
      bank_transaction_id: line,
    };
    const used = await addMovement(db, u, withLine);
    await assert.rejects(addMovement(db, u, withLine), /já está em outro/);
    const goals = await listGoals(db, u);
    assert.equal(goals[0].verified_cents, "2500");
    // Histórico da tela Copiloto: sem cancelados, do mais novo ao mais antigo.
    assert.deepEqual(
      goals[0].movements.map((m) => [m.date, m.kind, m.cents, m.verified]),
      [
        ["2026-11-07", "deposit", "6000", false],
        ["2026-11-05", "deposit", "2500", true],
      ],
    );
    await voidMovement(db, u, { id: used.id, reason: "troquei de ideia" });
    await addMovement(db, u, withLine);
    await saveEverydayWeekly(db, u, { amount: "350,00" });
    await saveEverydayWeekly(db, u, { amount: "400,00" });
    const weekly = await asUser(db, u.userId, (tx) =>
      tx.query<{ v: string }>(
        "SELECT everyday_weekly_cents::text AS v FROM household_finance_settings",
      ),
    );
    assert.deepEqual(weekly.rows, [{ v: "40000" }]);
  } finally {
    await db.close();
  }
});

test("leitor e outra família não escrevem nem leem", async () => {
  const db = await openDatabase();
  try {
    const u = await family(db, "rls-a");
    const goal = await firstGoal(db, u);
    await assert.rejects(
      savePlan(
        db,
        { ...u, role: "reader" },
        {
          goal_id: goal,
          month: "2026-11",
          planned: "10,00",
        },
      ),
    );
    const other = await family(db, "rls-b");
    assert.equal((await listGoals(db, other)).length, 0);
    await assert.rejects(
      addMovement(db, other, {
        goal_id: goal,
        kind: "deposit",
        amount: "10,00",
        date: "2026-11-06",
      }),
      /Objetivo não encontrado/,
    );
    const hacked = await asUser(db, other.userId, (tx) =>
      tx.query("UPDATE goals SET name='x' WHERE household_id=$1 RETURNING id", [
        u.familyId,
      ]),
    );
    assert.equal(hacked.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("createGoal: nasce depois das existentes na prioridade, com meta e prazo", async () => {
  const db = await openDatabase();
  try {
    const u = await family(db, "cria");
    await firstGoal(db, u);
    const { id } = await createGoal(db, u, {
      name: "Viagem",
      target: "2.000,00",
      deadline_month: "2027-07",
    });
    const goals = await listGoals(db, u);
    const created = goals.find((g) => g.id === id);
    assert.equal(created?.name, "Viagem");
    assert.equal(created?.target_cents, "200000");
    assert.equal(created?.deadline_month, "2027-07-01");
    assert.equal(created?.priority, 2, "entra depois da primeira reserva (prioridade 1)");

    await assert.rejects(
      createGoal(db, { ...u, role: "reader" }, { name: "x", target: "10,00", deadline_month: null }),
      UserError,
    );
  } finally {
    await db.close();
  }
});

test("updateGoal: muda nome/meta/prazo com versão certa, recusa a errada", async () => {
  const db = await openDatabase();
  try {
    const u = await family(db, "edita");
    const goal = await firstGoal(db, u);
    const [before] = await listGoals(db, u);

    await assert.rejects(
      updateGoal(db, u, {
        goal_id: goal,
        name: "Nova",
        target: "600,00",
        deadline_month: null,
        version: before.version + 5,
      }),
      UserError,
    );

    const saved = await updateGoal(db, u, {
      goal_id: goal,
      name: "Carro",
      target: "900,00",
      deadline_month: "2027-01",
      version: before.version,
    });
    assert.equal(saved.version, before.version + 1);
    const [after] = await listGoals(db, u);
    assert.equal(after.name, "Carro");
    assert.equal(after.target_cents, "90000");
    assert.equal(after.deadline_month, "2027-01-01");
  } finally {
    await db.close();
  }
});

test("goalBalance separa verificado de declarado e ignora cancelados", () => {
  const m = (
    kind: "deposit" | "withdrawal",
    cents: bigint,
    bank: string | null,
    voided = false,
  ): ReserveMovement => ({
    kind,
    cents,
    bank_transaction_id: bank,
    voided,
  });
  assert.deepEqual(
    goalBalance([
      m("deposit", 1000n, "b1"),
      m("deposit", 500n, null),
      m("withdrawal", 200n, null),
      m("deposit", 9999n, null, true),
    ]),
    { saved: 1300n, verified: 1000n, declared: 300n },
  );
  assert.equal(cycleStatus({ plan: null, movements: [] }), "not_planned");
  assert.equal(
    cycleStatus({ plan: { planned_cents: 0n }, movements: [] }),
    "skipped",
  );
});
