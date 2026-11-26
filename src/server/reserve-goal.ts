import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite, ensureFirstGoal, listGoals, money } from "./reserves.ts";

const locationSchema = z
  .object({
    goal_id: z.uuid(),
    location: z.enum(["same_account", "elsewhere"]),
    version: z.number().int().min(1),
  })
  .strict();

const deadlineMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .nullable();
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    target: z.string().max(30),
    deadline_month: deadlineMonth,
  })
  .strict();
const updateSchema = createSchema
  .extend({
    goal_id: z.uuid(),
    version: z.number().int().min(1),
  })
  .strict();

export async function readReserves(db: Database, user: Identity) {
  if (user.role !== "reader")
    await asUser(db, user.userId, (tx) => ensureFirstGoal(tx, { user }));
  return listGoals(db, user);
}

// Nova reserva: sempre por trás das já existentes (prioridade = próxima
// disponível), para não embaralhar a ordem em que o Copiloto pergunta.
export async function createGoal(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => createGoalTx(tx, user, raw));
}

export async function createGoalTx(
  tx: Transaction,
  user: Identity,
  raw: unknown,
) {
  const input = createSchema.parse(raw);
  const target_cents = money(input.target, false);
  const deadline = input.deadline_month ? input.deadline_month + "-01" : null;
  const id = randomUUID();
  const rows = await tx.query<{ max: number | null }>(
    "SELECT max(priority)::int AS max FROM goals WHERE household_id=$1",
    [user.familyId],
  );
  const priority = Math.min(99, (rows.rows[0]?.max ?? 0) + 1);
  await tx.query(
    `INSERT INTO goals(id,household_id,name,target_cents,deadline_month,priority,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, user.familyId, input.name, target_cents.toString(), deadline, priority, user.userId],
  );
  await recordAudit(tx, user.familyId, user.userId, "goal.create", id, {
    name: input.name,
    target_cents: target_cents.toString(),
    deadline_month: deadline,
  });
  return { id };
}

// Nome, meta e prazo são os únicos campos editáveis aqui — prioridade e
// status mudam por outros fluxos (ainda não construídos).
export async function updateGoal(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = updateSchema.parse(raw);
  const target_cents = money(input.target, false);
  const deadline = input.deadline_month ? input.deadline_month + "-01" : null;
  return asUser(db, user.userId, async (tx) => {
    const updated = await tx.query<{ version: number }>(
      `UPDATE goals SET name=$1,target_cents=$2,deadline_month=$3,version=version+1,updated_at=now()
       WHERE id=$4 AND household_id=$5 AND version=$6 RETURNING version`,
      [input.name, target_cents.toString(), deadline, input.goal_id, user.familyId, input.version],
    );
    if (!updated.rows.length) {
      const exists = await tx.query(
        "SELECT 1 FROM goals WHERE id=$1 AND household_id=$2",
        [input.goal_id, user.familyId],
      );
      throw new UserError(
        exists.rows.length
          ? "O objetivo mudou no outro aparelho. Atualize antes de salvar."
          : "Objetivo não encontrado.",
      );
    }
    await recordAudit(tx, user.familyId, user.userId, "goal.update", input.goal_id, {
      name: input.name,
      target_cents: target_cents.toString(),
      deadline_month: deadline,
    });
    return { version: updated.rows[0].version };
  });
}

export async function saveGoalLocation(
  db: Database,
  user: Identity,
  raw: unknown,
) {
  canWrite(user);
  const input = locationSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const updated = await tx.query<{ version: number }>(
      `UPDATE goals SET location=$1,version=version+1,updated_at=now()
       WHERE id=$2 AND household_id=$3 AND version=$4 RETURNING version`,
      [input.location, input.goal_id, user.familyId, input.version],
    );
    if (!updated.rows.length) {
      const exists = await tx.query(
        "SELECT 1 FROM goals WHERE id=$1 AND household_id=$2",
        [input.goal_id, user.familyId],
      );
      throw new UserError(
        exists.rows.length
          ? "O objetivo mudou no outro aparelho. Atualize antes de salvar."
          : "Objetivo não encontrado.",
      );
    }
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "reserve.location",
      input.goal_id,
      { location: input.location },
    );
    return { version: updated.rows[0].version };
  });
}
