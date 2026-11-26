import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";

// Fase 4 de docs/SPEC-FATOS-CARTAO.md. Cancelar tira o evento dos cálculos e o
// mantém visível; restaurar devolve. Nada é apagado.

export const USER_CANCEL_REASON = "Cancelado por você.";

export function requireWriter(user: Identity) {
  if (!["owner", "editor"].includes(user.role))
    throw new UserError("Seu acesso é somente para leitura.");
}

export async function cancelEvent(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ event_id: z.uuid(), reason: z.string().trim().max(300).default("") })
    .strict()
    .parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const result = await tx.query(
      "UPDATE economic_events SET cancelled_at=now(),cancel_reason=$1 WHERE id=$2 AND household_id=$3 AND cancelled_at IS NULL RETURNING id",
      [input.reason || USER_CANCEL_REASON, input.event_id, user.familyId],
    );
    if (!result.rows.length) throw new UserError("Movimento indisponível ou já cancelado.");
    await recordAudit(tx, user.familyId, user.userId, "event.cancel", input.event_id, {});
    return { event_id: input.event_id, cancelled: true };
  });
}

export async function restoreEvent(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z.object({ event_id: z.uuid() }).strict().parse(raw);
  return asUser(db, user.userId, async (tx) => {
    // Enquanto o banco não traz o movimento, a próxima leitura o cancelaria de novo.
    const gone = await tx.query(
      "SELECT 1 FROM bank_transactions WHERE event_id=$1 AND household_id=$2 AND auto_recorded AND missing",
      [input.event_id, user.familyId],
    );
    if (gone.rows.length)
      throw new UserError("O banco não traz mais este movimento. Ele volta sozinho se reaparecer.");
    const result = await tx.query(
      "UPDATE economic_events SET cancelled_at=NULL,cancel_reason=NULL WHERE id=$1 AND household_id=$2 AND cancelled_at IS NOT NULL RETURNING id",
      [input.event_id, user.familyId],
    );
    if (!result.rows.length) throw new UserError("Movimento indisponível ou não cancelado.");
    await recordAudit(tx, user.familyId, user.userId, "event.restore", input.event_id, {});
    return { event_id: input.event_id, cancelled: false };
  });
}
