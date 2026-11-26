import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { dateOnly } from "../domain/finance.ts";
import { goalBalance } from "../domain/reserve.ts";
import { UserError } from "./imports.ts";
import { canWrite, loadMovements, lockGoal, money } from "./reserves.ts";

// Movimentos de reserva: depósito e retirada, sempre por objetivo. Corrigir é
// cancelar (voided_*), nunca apagar, para o histórico seguir legível.

const movementSchema = z
  .object({
    goal_id: z.uuid(),
    plan_id: z.uuid().optional(),
    kind: z.enum(["deposit", "withdrawal"]),
    amount: z.string().max(30),
    date: z.string(),
    bank_transaction_id: z.uuid().optional(),
  })
  .strict();
const voidSchema = z
  .object({ id: z.uuid(), reason: z.string().trim().min(3).max(300) })
  .strict();

async function checkBankLine(
  tx: Transaction,
  user: Identity,
  input: { id: string; kind: "deposit" | "withdrawal" },
) {
  const line = (
    await tx.query<{ amount_cents: string }>(
      "SELECT amount_cents::text FROM bank_transactions WHERE id=$1 AND household_id=$2",
      [input.id, user.familyId],
    )
  ).rows[0];
  if (!line) throw new UserError("Lançamento do banco não encontrado.");
  const out = BigInt(line.amount_cents) < 0n;
  if (out !== (input.kind === "deposit"))
    throw new UserError(
      input.kind === "deposit"
        ? "Para um depósito, escolha uma saída do banco."
        : "Para uma retirada, escolha uma entrada do banco.",
    );
  const used = await tx.query(
    "SELECT 1 FROM reserve_movements WHERE household_id=$1 AND bank_transaction_id=$2 AND voided_at IS NULL",
    [user.familyId, input.id],
  );
  if (used.rows.length)
    throw new UserError("Esse lançamento do banco já está em outro movimento.");
}

export async function addMovement(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => addMovementTx(tx, user, raw));
}

export async function addMovementTx(
  tx: Transaction,
  user: Identity,
  raw: unknown,
) {
  const input = movementSchema.parse(raw);
  const amount = money(input.amount, false);
  const date = dateOnly(input.date);
  const { location } = await lockGoal(tx, user.familyId, input.goal_id);
  // Sem saber onde o dinheiro fica, o motor não sabe se desconta do livre.
  if (location === null)
    throw new UserError("Antes de guardar, diga onde esse dinheiro fica.");
  if (input.kind === "withdrawal") {
    const { saved } = goalBalance(
      await loadMovements(tx, user.familyId, input.goal_id),
    );
    if (amount > saved)
      throw new UserError("A retirada é maior que o saldo guardado.");
  }
  if (input.bank_transaction_id)
    await checkBankLine(tx, user, {
      id: input.bank_transaction_id,
      kind: input.kind,
    });
  const id = randomUUID();
  await tx.query(
    `INSERT INTO reserve_movements(id,household_id,goal_id,plan_id,kind,cents,date,bank_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      user.familyId,
      input.goal_id,
      input.plan_id ?? null,
      input.kind,
      amount,
      date,
      input.bank_transaction_id ?? null,
      user.userId,
    ],
  );
  await recordAudit(tx, user.familyId, user.userId, "reserve.movement", id, {
    goal_id: input.goal_id,
    kind: input.kind,
    cents: amount.toString(),
  });
  return { id };
}

export async function voidMovement(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = voidSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const found = (
      await tx.query<{ goal_id: string }>(
        "SELECT goal_id FROM reserve_movements WHERE id=$1 AND household_id=$2 AND voided_at IS NULL",
        [input.id, user.familyId],
      )
    ).rows[0];
    if (!found)
      throw new UserError("Movimento não encontrado ou já cancelado.");
    await lockGoal(tx, user.familyId, found.goal_id);
    await tx.query(
      "UPDATE reserve_movements SET voided_at=now(),voided_by=$1,void_reason=$2 WHERE id=$3 AND household_id=$4",
      [user.userId, input.reason, input.id, user.familyId],
    );
    const { saved } = goalBalance(
      await loadMovements(tx, user.familyId, found.goal_id),
    );
    if (saved < 0n)
      throw new UserError(
        "Cancelar esse depósito deixaria o saldo negativo. Cancele antes a retirada.",
      );
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "reserve.void",
      input.id,
      {
        reason: input.reason,
      },
    );
    return { id: input.id };
  });
}
