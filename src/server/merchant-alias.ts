import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit } from "./db.ts";
import type { Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { merchantKey } from "../domain/merchant-key.ts";

const MAX_ALIAS = 60;
const MAX_KEY = 200;
const MOVEMENT_ID = z.string().regex(/^(event|bankpending):[0-9a-f-]{36}$/);

type Source = "event" | "bankpending";

/** Chave do movimento, calculada da descrição lida no servidor (a pessoa nunca a envia). */
async function keyOf(tx: Transaction, familyId: string, movementId: string) {
  const [source, id] = movementId.split(":") as [Source, string];
  const found = await tx.query<{ description: string }>(
    source === "event"
      ? "SELECT description FROM economic_events WHERE id=$1 AND household_id=$2"
      : "SELECT description FROM bank_transactions WHERE id=$1 AND household_id=$2",
    [id, familyId],
  );
  if (!found.rows.length) throw new UserError("Movimento indisponível.");
  const key = merchantKey(found.rows[0].description);
  if (!key || key.length > MAX_KEY)
    throw new UserError("Este movimento não tem um nome que dê para reconhecer.");
  return { key, source, id };
}

/** Quantos lançamentos da casa o nome alcança: eventos ativos e pendentes do banco ainda sem evento. */
async function reach(tx: Transaction, familyId: string, key: string): Promise<number> {
  const count = await tx.query<{ n: number }>(
    `SELECT ((SELECT count(*) FROM economic_events WHERE household_id=$1 AND cancelled_at IS NULL AND merchant_key(description)=$2)
      + (SELECT count(*) FROM bank_transactions WHERE household_id=$1 AND status='pending' AND event_id IS NULL AND NOT missing AND merchant_key(description)=$2))::int AS n`,
    [familyId, key],
  );
  return count.rows[0].n;
}

/**
 * Dá (ou tira) um nome a quem recebeu ou ao lugar de um movimento. Vale para
 * todos os lançamentos da casa com a mesma chave (merchant_key em SQL).
 */
export async function setMerchantAlias(db: Database, user: Identity, raw: unknown) {
  if (!["owner", "editor"].includes(user.role))
    throw new UserError("Seu acesso é somente para leitura.");
  const input = z.object({ movement_id: MOVEMENT_ID, alias: z.string().nullable() }).strict().parse(raw);
  const alias = input.alias?.trim() || null;
  if (alias && alias.length > MAX_ALIAS)
    throw new UserError(`O nome pode ter no máximo ${MAX_ALIAS} caracteres.`);
  return asUser(db, user.userId, async (tx) => {
    const { key, source, id } = await keyOf(tx, user.familyId, input.movement_id);
    if (alias)
      await tx.query(
        "INSERT INTO merchant_aliases(household_id,key,alias,created_by,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(household_id,key) DO UPDATE SET alias=EXCLUDED.alias,created_by=EXCLUDED.created_by,updated_at=now()",
        [user.familyId, key, alias, user.userId],
      );
    else await tx.query("DELETE FROM merchant_aliases WHERE household_id=$1 AND key=$2", [user.familyId, key]);
    const keyCount = await reach(tx, user.familyId, key);
    await recordAudit(tx, user.familyId, user.userId, "merchant_alias.set", id, { source, cleared: alias === null });
    return { movement_id: input.movement_id, alias, key_count: keyCount };
  });
}

/** O nome já dado e o alcance, para a tela mostrar ANTES de salvar. Só leitura. */
export async function readMerchantAlias(db: Database, user: Identity, movementId: unknown) {
  const id = MOVEMENT_ID.parse(movementId);
  return asUser(db, user.userId, async (tx) => {
    const { key } = await keyOf(tx, user.familyId, id);
    const current = await tx.query<{ alias: string }>(
      "SELECT alias FROM merchant_aliases WHERE household_id=$1 AND key=$2",
      [user.familyId, key],
    );
    return { alias: current.rows[0]?.alias ?? null, key_count: await reach(tx, user.familyId, key) };
  });
}
