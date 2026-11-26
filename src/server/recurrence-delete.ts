import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { loadRecurrence, lockRecurrences } from "./recurrence-sync.ts";

const deleteSchema = z.object({ recurrence_id: z.uuid() }).strict();

// Excluir só vale para conta fixa que nunca teve pagamento nem ligação com o
// banco: sem histórico, ela some de todos os meses e da lista. Com histórico,
// a pessoa usa "Encerrar", que preserva o que já foi pago.
export async function deleteRecurrence(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = deleteSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await lockRecurrences(tx, user.familyId);
    const r = await loadRecurrence(tx, user.familyId, input.recurrence_id);
    const { rows } = await tx.query<{ item_id: string; realized: boolean }>(
      `SELECT i.id AS item_id, (i.status<>'open' OR i.paid_cents IS NOT NULL OR i.event_id IS NOT NULL) AS realized
         FROM recurrence_occurrences o
         JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
        WHERE o.household_id=$1 AND o.recurrence_id=$2 AND NOT i.archived`,
      [user.familyId, r.id],
    );
    const replaces = await tx.query("SELECT 1 FROM recurrences WHERE household_id=$1 AND id=$2 AND replaces_id IS NOT NULL", [user.familyId, r.id]);
    if (rows.some((row) => row.realized) || replaces.rows.length)
      throw new UserError("Esta conta fixa já tem contas pagas ou ligadas ao banco. Use Encerrar para manter o que já foi pago.");
    // Fim na véspera do início: nenhuma data entra, e o sync não recria contas.
    await tx.query("UPDATE recurrences SET end_date=start_date - 1 WHERE household_id=$1 AND id=$2", [user.familyId, r.id]);
    if (rows.length)
      await tx.query(
        "UPDATE monthly_items SET archived=true, version=version+1, updated_at=now() WHERE household_id=$1 AND id = ANY($2::uuid[])",
        [user.familyId, rows.map((row) => row.item_id)],
      );
    await recordAudit(tx, user.familyId, user.userId, "recurrence.delete", r.id, { archived: rows.length });
    return { recurrence_id: r.id, archived: rows.length };
  });
}
