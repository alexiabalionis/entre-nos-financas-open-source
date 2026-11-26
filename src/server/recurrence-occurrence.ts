import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { lockRecurrences } from "./recurrence-sync.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const target = { item_id: z.uuid(), version: z.number().int() };
const cancelSchema = z.object(target).strict();
const moveSchema = z
  .object({ ...target, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), due_date: isoDate.nullable() })
  .strict();
const dueSchema = z.object({ ...target, due_date: isoDate }).strict();

type Editable = { month: string; due_date: string | null };

// Só item aberto, sem pagamento nem conciliação, que pertence a uma série.
async function editableItem(tx: Transaction, familyId: string, input: { item_id: string; version: number }): Promise<Editable> {
  const { rows } = await tx.query<Editable & { version: number; locked: boolean; archived: boolean }>(
    `SELECT i.month::text AS month, i.due_date::text AS due_date, i.version, i.archived,
            (i.status<>'open' OR i.paid_cents IS NOT NULL OR i.event_id IS NOT NULL) AS locked
       FROM monthly_items i JOIN recurrence_occurrences o ON o.household_id=i.household_id AND o.monthly_item_id=i.id
      WHERE i.household_id=$1 AND i.id=$2 FOR UPDATE OF i`,
    [familyId, input.item_id],
  );
  const item = rows[0];
  if (!item) throw new UserError("Esse item não pertence a uma recorrência.");
  if (item.archived || item.locked) throw new UserError("Só dá para mexer em previsão aberta, sem pagamento nem conciliação.");
  if (item.version !== input.version) throw new UserError("O item mudou. Abra de novo e tente outra vez.");
  return item;
}

function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

async function updateItem(tx: Transaction, familyId: string, itemId: string, month: string, dueDate: string | null) {
  await tx.query(
    `UPDATE monthly_items SET month=$3, due_date=$4, version=version+1, updated_at=now()
      WHERE household_id=$1 AND id=$2`,
    [familyId, itemId, month, dueDate],
  );
}

export async function cancelOccurrence(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = cancelSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    await editableItem(tx, user.familyId, input);
    await tx.query(
      "UPDATE monthly_items SET archived=true, version=version+1, updated_at=now() WHERE household_id=$1 AND id=$2",
      [user.familyId, input.item_id],
    );
    await recordAudit(tx, user.familyId, user.userId, "recurrence.cancel", input.item_id);
    return { cancelled: true };
  });
}

export async function moveCompetence(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = moveSchema.parse(raw);
  const month = `${input.month}-01`;
  if (input.due_date !== null && monthOf(input.due_date) !== month)
    throw new UserError("O vencimento precisa cair no novo mês, ou ficar vazio.");
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const item = await editableItem(tx, user.familyId, input);
    if (item.month === month) throw new UserError("O item já está nesse mês.");
    await updateItem(tx, user.familyId, input.item_id, month, input.due_date);
    await recordAudit(tx, user.familyId, user.userId, "routine.move", input.item_id, {
      kind: "competence",
      from: item.month,
      to: month,
      due_from: item.due_date,
      due_to: input.due_date,
    });
    return { month };
  });
}

export async function changeDueDate(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = dueSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const item = await editableItem(tx, user.familyId, input);
    if (monthOf(input.due_date) !== item.month)
      throw new UserError("O vencimento precisa ficar dentro do mês do item. Para mudar de mês, mova a competência.");
    await updateItem(tx, user.familyId, input.item_id, item.month, input.due_date);
    await recordAudit(tx, user.familyId, user.userId, "routine.move", input.item_id, {
      kind: "due_date",
      from: item.due_date,
      to: input.due_date,
    });
    return { due_date: input.due_date };
  });
}
