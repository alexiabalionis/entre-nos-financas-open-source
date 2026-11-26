import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { canWrite } from "./reserves.ts";

// "Agora não" das sugestões do Futuro, por casa: os dois parceiros dividem.

const dismissSchema = z.object({
  id: z.string().min(1).max(200),
  metric: z.string().regex(/^-?\d+$/).nullable(),
});

export async function listDismissed(
  db: Database,
  user: Identity,
): Promise<{ id: string; metric: string | null }[]> {
  return asUser(db, user.userId, async (tx) => {
    const r = await tx.query<{ id: string; metric: string | null }>(
      `SELECT suggestion_id AS id,metric_cents::text AS metric FROM dismissed_suggestions
       WHERE household_id=$1 ORDER BY suggestion_id`,
      [user.familyId],
    );
    return r.rows;
  });
}

export async function dismissSuggestion(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = dismissSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    await tx.query(
      `INSERT INTO dismissed_suggestions(household_id,suggestion_id,metric_cents,dismissed_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(household_id,suggestion_id) DO UPDATE
       SET metric_cents=excluded.metric_cents,dismissed_by=excluded.dismissed_by,dismissed_at=now()`,
      [user.familyId, input.id, input.metric, user.userId],
    );
    return { id: input.id, metric: input.metric };
  });
}

export async function restoreSuggestions(db: Database, user: Identity) {
  canWrite(user);
  return asUser(db, user.userId, async (tx) => {
    await tx.query("DELETE FROM dismissed_suggestions WHERE household_id=$1", [user.familyId]);
    return { ok: true };
  });
}
