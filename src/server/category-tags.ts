import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import { asUser, recordAudit } from "./db.ts";
import type { Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { resolveCategory } from "./assisted.ts";

const MAX_NAME = 120;
const DUPLICATE = "Já existe uma etiqueta com esse nome nesta categoria.";

function requireWriter(user: Identity) {
  if (!["owner", "editor"].includes(user.role))
    throw new UserError("Seu acesso é somente para leitura.");
}

function cleanName(raw: string) {
  const name = raw.trim();
  if (!name) throw new UserError("Informe um nome para a etiqueta.");
  if (name.length > MAX_NAME)
    throw new UserError(`O nome pode ter no máximo ${MAX_NAME} caracteres.`);
  return name;
}

// A corrida entre dois pedidos iguais só aparece como violação do índice único.
function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function assertNameFree(
  tx: Transaction,
  familyId: string,
  categoryId: string,
  name: string,
  ignoreId: string | null,
) {
  const dup = await tx.query(
    "SELECT 1 FROM category_tags WHERE household_id=$1 AND category_id=$2 AND lower(btrim(name))=lower($3) AND ($4::uuid IS NULL OR id<>$4)",
    [familyId, categoryId, name, ignoreId],
  );
  if (dup.rows.length) throw new UserError(DUPLICATE);
}

/** Cria uma etiqueta numa categoria da família; nome único por categoria sem diferenciar maiúsculas. */
export async function createCategoryTag(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ category_id: z.uuid(), name: z.string() })
    .strict()
    .parse(raw);
  const name = cleanName(input.name);
  try {
    return await asUser(db, user.userId, async (tx) => {
      const category = await tx.query(
        "SELECT 1 FROM categories WHERE id=$1 AND household_id=$2",
        [input.category_id, user.familyId],
      );
      if (!category.rows.length) throw new UserError("Categoria indisponível.");
      await assertNameFree(tx, user.familyId, input.category_id, name, null);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO category_tags(id,household_id,category_id,name) VALUES($1,$2,$3,$4)",
        [id, user.familyId, input.category_id, name],
      );
      await recordAudit(tx, user.familyId, user.userId, "category_tag.create", id, {
        category_id: input.category_id,
      });
      return { id, category_id: input.category_id, name };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserError(DUPLICATE);
    throw error;
  }
}

/** Renomeia a etiqueta; os movimentos vinculam por id e acompanham o novo nome. */
export async function renameCategoryTag(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ tag_id: z.uuid(), name: z.string() })
    .strict()
    .parse(raw);
  const name = cleanName(input.name);
  try {
    return await asUser(db, user.userId, async (tx) => {
      const tag = await tx.query<{ category_id: string }>(
        "SELECT category_id FROM category_tags WHERE id=$1 AND household_id=$2",
        [input.tag_id, user.familyId],
      );
      if (!tag.rows.length) throw new UserError("Etiqueta indisponível.");
      const categoryId = tag.rows[0].category_id;
      await assertNameFree(tx, user.familyId, categoryId, name, input.tag_id);
      await tx.query(
        "UPDATE category_tags SET name=$1 WHERE id=$2 AND household_id=$3",
        [name, input.tag_id, user.familyId],
      );
      await recordAudit(tx, user.familyId, user.userId, "category_tag.rename", input.tag_id, {});
      return { id: input.tag_id, category_id: categoryId, name };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserError(DUPLICATE);
    throw error;
  }
}

/** Exclui a etiqueta e solta dos movimentos; categoria e valores ficam intactos. */
export async function deleteCategoryTag(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z.object({ tag_id: z.uuid() }).strict().parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const tag = await tx.query(
      "SELECT 1 FROM category_tags WHERE id=$1 AND household_id=$2",
      [input.tag_id, user.familyId],
    );
    if (!tag.rows.length) throw new UserError("Etiqueta indisponível.");
    const cleared = await tx.query(
      "UPDATE economic_events SET tag_id=NULL WHERE tag_id=$1 AND household_id=$2 RETURNING id",
      [input.tag_id, user.familyId],
    );
    const clearedBank = await tx.query(
      "UPDATE bank_transactions SET tag_id=NULL WHERE tag_id=$1 AND household_id=$2 RETURNING id",
      [input.tag_id, user.familyId],
    );
    const total = cleared.rows.length + clearedBank.rows.length;
    await tx.query("DELETE FROM category_tags WHERE id=$1 AND household_id=$2", [
      input.tag_id,
      user.familyId,
    ]);
    await recordAudit(tx, user.familyId, user.userId, "category_tag.delete", input.tag_id, {
      cleared: total,
    });
    return { tag_id: input.tag_id, cleared: total };
  });
}

/**
 * Grava (ou limpa) a etiqueta de um movimento do banco ainda pendente. A
 * categoria da linha vem das regras aprendidas, então a etiqueta precisa
 * pertencer à categoria que a linha tem agora.
 */
export async function setBankTransactionTag(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = z
    .object({ bank_transaction_id: z.uuid(), tag_id: z.uuid().nullable() })
    .strict()
    .parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const row = (
      await tx.query<{ description: string; status: string }>(
        "SELECT description,status FROM bank_transactions WHERE id=$1 AND household_id=$2",
        [input.bank_transaction_id, user.familyId],
      )
    ).rows[0];
    if (!row) throw new UserError("Movimento indisponível.");
    if (row.status !== "pending")
      throw new UserError("Este movimento já foi registrado.");
    if (input.tag_id) {
      const tag = (
        await tx.query<{ category_name: string }>(
          "SELECT c.name AS category_name FROM category_tags t JOIN categories c ON c.id=t.category_id AND c.household_id=t.household_id WHERE t.id=$1 AND t.household_id=$2",
          [input.tag_id, user.familyId],
        )
      ).rows[0];
      const rules = (
        await tx.query<{ match_text: string; category_name: string }>(
          "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
          [user.familyId],
        )
      ).rows;
      if (!tag || tag.category_name !== resolveCategory(rules, row.description).name)
        throw new UserError("Etiqueta indisponível para esta categoria.");
    }
    await tx.query(
      "UPDATE bank_transactions SET tag_id=$1 WHERE id=$2 AND household_id=$3",
      [input.tag_id, input.bank_transaction_id, user.familyId],
    );
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "bank_transaction.tag",
      input.bank_transaction_id,
      { tag_id: input.tag_id },
    );
    return { bank_transaction_id: input.bank_transaction_id, tag_id: input.tag_id };
  });
}
