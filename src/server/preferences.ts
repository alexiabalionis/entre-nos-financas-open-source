import { z } from "zod";
import sharp from "sharp";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import {
  defaultPreferences,
  homeCards,
  normalizeHomeOrder,
  type Preferences,
} from "../domain/preferences.ts";
const ids = homeCards.map((c) => c[0]);
const cards = z
  .array(z.enum(ids))
  .max(ids.length)
  .refine((a) => new Set(a).size === a.length);
const schema = z
  .object({
    revision: z.number().int().min(0),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    card_order: cards.refine((a) => a.length === ids.length).optional(),
    hidden_cards: cards.optional(),
    photo: z.string().max(140000).nullable().optional(),
  })
  .strict();
export async function readPreferences(
  db: Database,
  u: Identity,
): Promise<Preferences> {
  return asUser(db, u.userId, async (tx) => {
    const r = (
      await tx.query<Preferences>(
        `SELECT accent,theme,card_order,hidden_cards,revision,photo IS NOT NULL AS has_photo,onboarding_completed_at IS NOT NULL AS onboarding_done FROM user_preferences WHERE user_id=$1`,
        [u.userId],
      )
    ).rows[0];
    if (!r) return { ...defaultPreferences };
    const { card_order, hidden_cards } = normalizeHomeOrder(
      r.card_order,
      r.hidden_cards,
    );
    return { ...r, card_order, hidden_cards };
  });
}
// Normaliza card_order/hidden_cards do payload do cliente ANTES da validação
// zod: um cliente com UI antiga manda uma ordem com menos ids do que
// homeCards conhece hoje, e o refine de card_order exige comprimento igual
// a homeCards.length. Só toca o(s) campo(s) que o cliente de fato enviou —
// payload parcial (ex.: só accent) continua sem tocar em card_order/hidden.
function preNormalizeHomeOrder(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const hasOrder = Array.isArray(r.card_order);
  const hasHidden = Array.isArray(r.hidden_cards);
  if (!hasOrder && !hasHidden) return raw;
  const { card_order, hidden_cards } = normalizeHomeOrder(
    hasOrder ? (r.card_order as unknown[]).map(String) : [],
    hasHidden ? (r.hidden_cards as unknown[]).map(String) : [],
  );
  return {
    ...r,
    ...(hasOrder ? { card_order } : {}),
    ...(hasHidden ? { hidden_cards } : {}),
  };
}
export async function readProfilePhoto(db: Database, u: Identity) {
  return asUser(
    db,
    u.userId,
    async (tx) =>
      (
        await tx.query<{ photo: Uint8Array }>(
          "SELECT photo FROM user_preferences WHERE user_id=$1 AND photo IS NOT NULL",
          [u.userId],
        )
      ).rows[0]?.photo ?? null,
  );
}
export async function savePreferences(db: Database, u: Identity, raw: unknown) {
  const v = schema.parse(preNormalizeHomeOrder(raw));
  let photo: Buffer | null | undefined;
  if (v.photo === null) photo = null;
  else if (v.photo !== undefined) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v.photo))
      throw new UserError("Escolha uma foto válida.");
    const input = Buffer.from(v.photo, "base64");
    if (input.length > 100000) throw new UserError("A foto é muito grande.");
    try {
      const processor = sharp(input, {
        limitInputPixels: 4000000,
        animated: false,
        failOn: "warning",
      });
      const meta = await processor.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
        throw new Error();
      photo = await processor
        .rotate()
        .resize(256, 256, { fit: "cover" })
        .jpeg({ quality: 82 })
        .toBuffer();
      if (photo.length > 100000) throw new Error();
    } catch {
      throw new UserError(
        "Não foi possível processar a foto. Escolha uma imagem JPG, PNG ou WebP.",
      );
    }
  }
  await asUser(db, u.userId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "preferences:" + u.userId,
    ]);
    const prior = (
      await tx.query<{ revision: number }>(
        "SELECT revision FROM user_preferences WHERE user_id=$1",
        [u.userId],
      )
    ).rows[0];
    if ((prior?.revision ?? 0) !== v.revision)
      throw new UserError(
        "Suas preferências mudaram em outro aparelho. Recarregue antes de salvar.",
      );
    await tx.query(
      "INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [u.userId],
    );
    await tx.query(
      `UPDATE user_preferences SET accent=coalesce($2,accent),theme=coalesce($3,theme),card_order=coalesce($4::jsonb,card_order),hidden_cards=coalesce($5::jsonb,hidden_cards),photo=CASE WHEN $6 THEN $7::bytea ELSE photo END,revision=$8,updated_at=now() WHERE user_id=$1`,
      [
        u.userId,
        v.accent ?? null,
        v.theme ?? null,
        v.card_order ? JSON.stringify(v.card_order) : null,
        v.hidden_cards ? JSON.stringify(v.hidden_cards) : null,
        photo !== undefined,
        photo ?? null,
        v.revision + 1,
      ],
    );
  });
  return readPreferences(db, u);
}
export async function completeOnboarding(db: Database, u: Identity) {
  await asUser(db, u.userId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "preferences:" + u.userId,
    ]);
    await tx.query(
      `INSERT INTO user_preferences(user_id,onboarding_completed_at) VALUES($1,now()) ON CONFLICT(user_id) DO UPDATE SET onboarding_completed_at=coalesce(user_preferences.onboarding_completed_at,excluded.onboarding_completed_at)`,
      [u.userId],
    );
  });
  return readPreferences(db, u);
}
