import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "../src/server/db.ts";
import { createFamily, issueSession, identity, type Identity } from "../src/server/auth.ts";
import { createManualEventTx } from "../src/server/manual.ts";
import { checkItem } from "../src/server/routine.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import type { ProjectionReport } from "../src/server/projection.ts";

export const TODAY = "2026-11-09";

export type World = {
  db: PGlite;
  user: Identity;
  bank: string;
  housing: string;
  market: string;
};

// Família com uma conta corrente de saldo confirmado hoje e as categorias
// Moradia (dona do teto e das contas fixas) e Alimentação (dia a dia).
export async function setupWorld(db: PGlite, tag: string, today = TODAY): Promise<World> {
  const email = `no-double-${tag}@example.invalid`;
  await createFamily(db, { email, name: tag, password: "SenhaFicticia!2026", familyName: tag });
  const userId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  const user = (await identity(db, await issueSession(db, userId)))!;
  const category = async (name: string) =>
    (await db.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [user.familyId, name])).rows[0].id;
  const bank = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,balance_confirmed_cents,balance_confirmed_at,created_by) VALUES($1,$2,'Corrente','Inst','BRL','checking',0,'2025-12-31',500000,$4,$3)",
    [bank, user.familyId, user.userId, today],
  );
  return { db, user, bank, housing: await category("Moradia"), market: await category("Alimentação") };
}

// Lançamento manual aprovado (ledger incluído). Valor positivo = saída.
export async function spend(
  w: World,
  o: { account?: string; date: string; description: string; cents: number; kind?: string; category?: string | null },
): Promise<string> {
  const sign = o.kind === "income" ? "" : "-";
  const reais = (o.cents / 100).toFixed(2).replace(".", ",");
  return (await asUser(w.db, w.user.userId, (tx) =>
    createManualEventTx(tx, w.user, {
      account_id: o.account ?? w.bank,
      date: o.date,
      description: o.description,
      amount: `${sign}${reais}`,
      kind: o.kind ?? "expense",
      category_id: "category" in o ? o.category : w.housing,
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    }),
  )) as string;
}

// Cria uma conta fixa de despesa em Moradia e devolve o id da série.
export async function fixedBill(
  w: World,
  o: { label: string; cents: number; start: string; frequency?: "month" | "week" | "year"; account?: string; today?: string },
): Promise<string> {
  const r = await createRecurrence(w.db, w.user, {
    purpose: "expense",
    label: o.label,
    category_id: w.housing,
    expected_cents: o.cents,
    frequency: o.frequency ?? "month",
    start_date: o.start,
    today: o.today ?? TODAY,
    ...(o.account ? { account_id: o.account } : {}),
  });
  return r.recurrence_id;
}

export type SlotRow = { id: string; date: string; month: string; due: string | null; version: number };

// Itens (ocorrências) da série, em ordem de data, sem arquivados.
export async function slotsOf(db: PGlite, recurrenceId: string): Promise<SlotRow[]> {
  return (
    await db.query<SlotRow>(
      `SELECT i.id, o.occurrence_date::text AS date, i.month::text AS month, i.due_date::text AS due, i.version
         FROM recurrence_occurrences o JOIN monthly_items i ON i.id=o.monthly_item_id
        WHERE o.recurrence_id=$1 AND NOT i.archived ORDER BY o.occurrence_date`,
      [recurrenceId],
    )
  ).rows;
}

// Concilia o item ao lançamento: pago pelo valor do lançamento, na data dele.
export async function reconcile(
  w: World,
  slot: SlotRow,
  o: { eventId: string; cents: number; date: string },
): Promise<void> {
  const reais = (o.cents / 100).toFixed(2).replace(".", ",");
  await checkItem(w.db, w.user, {
    id: slot.id,
    version: slot.version,
    status: "done",
    amount: reais,
    date: o.date,
    event_id: o.eventId,
  });
}

// Saídas do relatório de projeção que nascem de um item do plano.
export const itemFlows = (report: ProjectionReport, itemId: string) =>
  report.flows.filter((f) => f.key === `item:${itemId}` || f.key === `item:${itemId}:paid`);

export const outTotal = (flows: readonly { direction: string; cons: { cents: bigint } }[]) =>
  flows.filter((f) => f.direction === "out").reduce((s, f) => s + f.cons.cents, 0n);
