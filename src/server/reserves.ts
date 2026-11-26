import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { cents } from "../domain/finance.ts";
import { goalBalance, type ReserveMovement } from "../domain/reserve.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { UserError } from "./imports.ts";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const planSchema = z
  .object({
    goal_id: z.uuid(),
    month,
    planned: z.string().max(30),
    version_of: z.uuid().optional(),
  })
  .strict();
const weeklySchema = z.object({ amount: z.string().max(30) }).strict();
// Mesmo aporte em `months` meses seguidos a partir de `from_month` (0 = pausa).
const rangeSchema = z
  .object({
    goal_id: z.uuid(),
    from_month: month,
    months: z.number().int().min(1).max(36),
    planned: z.string().max(30),
  })
  .strict();
// amount null = voltar ao padrão (meia semana típica).
const marginSchema = z
  .object({ amount: z.string().max(30).nullable() })
  .strict();

type Row = {
  kind: "deposit" | "withdrawal";
  cents: string;
  bank_transaction_id: string | null;
  voided: boolean;
};
type PlanRow = {
  id: string;
  goal_id: string;
  month: string;
  planned_cents: string;
};

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}
export function canWrite(user: Identity) {
  if (!["owner", "editor"].includes(user.role))
    throw new UserError("Seu acesso é só de leitura.");
}
export function money(value: string, allowZero: boolean): bigint {
  let result: bigint;
  try {
    result = cents(value);
  } catch (error) {
    throw new UserError((error as Error).message);
  }
  if (result < 0n || (result === 0n && !allowZero))
    throw new UserError("Informe um valor maior que zero.");
  return result;
}
function toMovement(r: Row): ReserveMovement {
  return {
    kind: r.kind,
    cents: BigInt(r.cents),
    bank_transaction_id: r.bank_transaction_id,
    voided: r.voided,
  };
}
export async function loadMovements(
  tx: Transaction,
  family: string,
  goal: string,
) {
  return (
    await tx.query<Row>(
      `SELECT kind,cents::text,bank_transaction_id,voided_at IS NOT NULL AS voided FROM reserve_movements WHERE household_id=$1 AND goal_id=$2`,
      [family, goal],
    )
  ).rows.map(toMovement);
}
export async function lockGoal(tx: Transaction, family: string, goal: string) {
  const found = await tx.query<{ location: string | null }>(
    "SELECT location FROM goals WHERE id=$1 AND household_id=$2 FOR UPDATE",
    [goal, family],
  );
  if (!found.rows.length) throw new UserError("Objetivo não encontrado.");
  return { location: found.rows[0].location };
}

export async function ensureFirstGoal(
  tx: Transaction,
  input: { user: Identity },
): Promise<void> {
  const { user } = input;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "first-goal:" + user.familyId,
  ]);
  const has = await tx.query("SELECT 1 FROM goals WHERE household_id=$1", [
    user.familyId,
  ]);
  if (has.rows.length) return;
  await tx.query(
    "INSERT INTO goals(id,household_id,name,target_cents,created_by) VALUES($1,$2,'Primeira reserva',50000,$3)",
    [randomUUID(), user.familyId, user.userId],
  );
}

export async function listGoals(db: Database, user: Identity) {
  const current = today().slice(0, 7) + "-01";
  return asUser(db, user.userId, async (tx) => {
    const goals = (
      await tx.query<{
        id: string;
        name: string;
        target_cents: string;
        deadline_month: string | null;
        priority: number;
        status: string;
        location: string | null;
        version: number;
      }>(
        `SELECT id,name,target_cents::text,deadline_month::text,priority,status,location,version FROM goals WHERE household_id=$1 ORDER BY priority,created_at`,
        [user.familyId],
      )
    ).rows;
    const plans = (
      await tx.query<PlanRow>(
        `SELECT id,goal_id,month::text,planned_cents::text FROM reserve_plans WHERE household_id=$1 AND month=$2 AND superseded_by IS NULL`,
        [user.familyId, current],
      )
    ).rows;
    // Histórico legível por objetivo: só movimentos válidos, do mais novo ao
    // mais antigo. verified = já ligado a uma linha do extrato.
    const history = (
      await tx.query<{
        id: string;
        goal_id: string;
        kind: "deposit" | "withdrawal";
        cents: string;
        date: string;
        verified: boolean;
      }>(
        `SELECT id,goal_id,kind,cents::text,date::text,bank_transaction_id IS NOT NULL AS verified
         FROM reserve_movements WHERE household_id=$1 AND voided_at IS NULL
         ORDER BY date DESC,created_at DESC`,
        [user.familyId],
      )
    ).rows;
    const result = [];
    for (const goal of goals) {
      const balance = goalBalance(
        await loadMovements(tx, user.familyId, goal.id),
      );
      result.push({
        ...goal,
        saved_cents: balance.saved.toString(),
        verified_cents: balance.verified.toString(),
        declared_cents: balance.declared.toString(),
        current_plan: plans.find((p) => p.goal_id === goal.id) ?? null,
        movements: history
          .filter((m) => m.goal_id === goal.id)
          .map((m) => ({
            id: m.id,
            kind: m.kind,
            cents: m.cents,
            date: m.date,
            verified: m.verified,
          })),
      });
    }
    return result;
  });
}

export async function savePlan(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = planSchema.parse(raw);
  const planned = money(input.planned, true);
  return asUser(db, user.userId, async (tx) => {
    await lockGoal(tx, user.familyId, input.goal_id);
    return savePlanTx(tx, user, {
      goal_id: input.goal_id,
      month: input.month,
      planned,
      version_of: input.version_of,
    });
  });
}

// Grava (substitui o vigente, nunca apaga) o plano de um mês. O objetivo já
// precisa estar travado pelo chamador (lockGoal).
export async function savePlanTx(
  tx: Transaction,
  user: Identity,
  input: { goal_id: string; month: string; planned: bigint; version_of?: string },
) {
  const first = input.month + "-01";
  const old = (
    await tx.query<{ id: string }>(
      `SELECT id FROM reserve_plans WHERE household_id=$1 AND goal_id=$2 AND month=$3 AND superseded_by IS NULL`,
      [user.familyId, input.goal_id, first],
    )
  ).rows[0];
  if (input.version_of && input.version_of !== old?.id)
    throw new UserError(
      "O plano mudou no outro aparelho. Atualize antes de salvar.",
    );
  const id = randomUUID();
  if (old)
    await tx.query(
      "UPDATE reserve_plans SET superseded_by=$1 WHERE id=$2 AND household_id=$3",
      [id, old.id, user.familyId],
    );
  await tx.query(
    `INSERT INTO reserve_plans(id,household_id,goal_id,month,planned_cents,plan_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, user.familyId, input.goal_id, first, input.planned, today(), user.userId],
  );
  await recordAudit(tx, user.familyId, user.userId, "reserve.plan", id, {
    goal_id: input.goal_id,
    month: first,
    planned_cents: input.planned.toString(),
    replaced: old?.id ?? null,
  });
  return { id };
}

// "Salvar como plano" do Copiloto Futuro: o mesmo aporte em vários meses
// seguidos, tudo numa transação. Cada mês substitui o plano vigente dele.
export async function savePlanRange(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = rangeSchema.parse(raw);
  const planned = money(input.planned, true);
  return asUser(db, user.userId, async (tx) => {
    await lockGoal(tx, user.familyId, input.goal_id);
    const ids: string[] = [];
    for (let i = 0; i < input.months; i++) {
      const { id } = await savePlanTx(tx, user, {
        goal_id: input.goal_id,
        month: shiftMonth(input.from_month, i),
        planned,
      });
      ids.push(id);
    }
    return { ids };
  });
}

export async function saveEverydayWeekly(
  db: Database,
  user: Identity,
  raw: unknown,
) {
  canWrite(user);
  const input = weeklySchema.parse(raw);
  const amount = money(input.amount, true);
  return asUser(db, user.userId, async (tx) => {
    await tx.query(
      `INSERT INTO household_finance_settings(household_id,everyday_weekly_cents,updated_by) VALUES($1,$2,$3)
       ON CONFLICT(household_id) DO UPDATE SET everyday_weekly_cents=excluded.everyday_weekly_cents,updated_by=excluded.updated_by,updated_at=now()`,
      [user.familyId, amount, user.userId],
    );
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "reserve.everyday_weekly",
      user.familyId,
      { cents: amount.toString() },
    );
    return { cents: amount.toString() };
  });
}

// Margem de segurança do Copiloto: o saldo mínimo que fica na conta até o
// próximo salário. Zero vale (sem margem); null volta ao padrão.
export async function saveCopilotMargin(
  db: Database,
  user: Identity,
  raw: unknown,
) {
  canWrite(user);
  const input = marginSchema.parse(raw);
  const amount = input.amount === null ? null : money(input.amount, true);
  return asUser(db, user.userId, async (tx) => {
    await tx.query(
      `INSERT INTO household_finance_settings(household_id,copilot_margin_cents,updated_by) VALUES($1,$2,$3)
       ON CONFLICT(household_id) DO UPDATE SET copilot_margin_cents=excluded.copilot_margin_cents,updated_by=excluded.updated_by,updated_at=now()`,
      [user.familyId, amount, user.userId],
    );
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "reserve.copilot_margin",
      user.familyId,
      { cents: amount === null ? null : amount.toString() },
    );
    return { cents: amount === null ? null : amount.toString() };
  });
}
