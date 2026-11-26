import { z } from "zod";
import { asUser, recordAudit } from "./db.ts";
import type { Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";

const MAX_NAME = 120;
const TOO_LONG = `O nome pode ter no máximo ${MAX_NAME} caracteres.`;

function requireWriter(user: Identity) {
  if (!["owner", "editor"].includes(user.role))
    throw new UserError("Seu acesso é somente para leitura.");
}

/**
 * Define ou limpa o apelido de um movimento (economic_events.display_name).
 * Só texto vazio explícito ou null limpa; nome longo demais é recusado, nunca
 * truncado. A descrição original não muda.
 */
export async function renameEvent(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ event_id: z.uuid(), name: z.string().nullable() })
    .strict()
    .parse(raw);
  const name = input.name?.trim() || null;
  if (name && name.length > MAX_NAME) throw new UserError(TOO_LONG);
  return asUser(db, user.userId, async (tx) => {
    const result = await tx.query(
      "UPDATE economic_events SET display_name=$1 WHERE id=$2 AND household_id=$3 RETURNING id",
      [name, input.event_id, user.familyId],
    );
    if (!result.rows.length) throw new UserError("Movimento indisponível.");
    await recordAudit(tx, user.familyId, user.userId, "event.rename", input.event_id, {
      cleared: name === null,
    });
    return { event_id: input.event_id, display_name: name };
  });
}

/** Renomeia uma conta ou cartão da família (accounts.name). */
export async function renameAccount(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ account_id: z.uuid(), name: z.string() })
    .strict()
    .parse(raw);
  const name = input.name.trim();
  if (!name) throw new UserError("Informe um nome para a conta.");
  if (name.length > MAX_NAME) throw new UserError(TOO_LONG);
  return asUser(db, user.userId, async (tx) => {
    const result = await tx.query(
      "UPDATE accounts SET name=$1 WHERE id=$2 AND household_id=$3 RETURNING id",
      [name, input.account_id, user.familyId],
    );
    if (!result.rows.length) throw new UserError("Conta indisponível.");
    await recordAudit(tx, user.familyId, user.userId, "account.rename", input.account_id, {});
    return { account_id: input.account_id, name };
  });
}
