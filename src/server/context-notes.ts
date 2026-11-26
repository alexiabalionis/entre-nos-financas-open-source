import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { readToday } from "./projection.ts";
import { readMonthFlows } from "./insights.ts";
import { readRealizedSpend } from "./realized-spend.ts";
import { fixedEventIds } from "./fixed-events.ts";
import { addDays } from "../domain/day.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { categoryByMonth } from "../domain/insights.ts";
import { sobraPaths, type SobraPaths, type MonthFlow, type CategoryMonth } from "../domain/sobra-paths.ts";
import type { Wire } from "./copilot.ts";

// Contexto da casa: notas ("por que passou") e categorias protegidas, por
// casa (RLS + household_id). A categoria chega pelo NOME e é resolvida aqui.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const keyShape = {
  scope: z.enum(["household", "category", "category_month"]),
  category: z.string().trim().min(1).max(120).optional(),
  month: z.string().regex(MONTH).optional(),
};
// Escopo manda: household sem categoria/mês; category só categoria;
// category_month os dois (o mesmo que o CHECK da tabela exige).
function checkKey(v: { scope: string; category?: string; month?: string }, ctx: z.RefinementCtx) {
  const ok =
    v.scope === "household"
      ? v.category === undefined && v.month === undefined
      : v.scope === "category"
        ? v.category !== undefined && v.month === undefined
        : v.category !== undefined && v.month !== undefined;
  if (!ok) ctx.addIssue({ code: "custom", message: "Combinação de escopo, categoria e mês inválida." });
}
const saveSchema = z
  .object({ ...keyShape, note: z.string().trim().min(1).max(500) })
  .strict()
  .superRefine(checkKey);
const deleteSchema = z.object(keyShape).strict().superRefine(checkKey);
const protectSchema = z
  .object({ category: z.string().trim().min(1).max(120), protected: z.boolean() })
  .strict();
const pathsSchema = z
  .object({
    pct: z.number().gt(0).max(80).optional(),
    cents: z.string().regex(/^\d{1,15}$/).optional(),
  })
  .strict()
  .refine((v) => (v.pct === undefined) !== (v.cents === undefined), {
    message: "Informe pct ou cents, só um.",
  });

async function categoryId(tx: Transaction, familyId: string, name: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    "SELECT id FROM categories WHERE household_id=$1 AND name=$2",
    [familyId, name],
  );
  if (!r.rows[0]) throw new UserError("Categoria não encontrada.");
  return r.rows[0].id;
}

export type ContextRead = {
  household: string | null;
  categories: { name: string; protected: boolean; note: string | null }[];
  monthNotes: { name: string; month: string; note: string }[];
};

export async function listContext(
  db: Database,
  user: Identity,
  opts: { month?: string } = {},
): Promise<ContextRead> {
  if (opts.month !== undefined) z.string().regex(MONTH).parse(opts.month);
  return asUser(db, user.userId, async (tx) => {
    const fam = user.familyId;
    const household = await tx.query<{ note: string }>(
      "SELECT note FROM context_notes WHERE household_id=$1 AND scope='household'",
      [fam],
    );
    const cats = await tx.query<{ name: string; protected: boolean; note: string | null }>(
      `SELECT c.name,coalesce(cc.protected,false) AS protected,n.note
       FROM categories c
       LEFT JOIN category_context cc ON cc.household_id=c.household_id AND cc.category_id=c.id
       LEFT JOIN context_notes n ON n.household_id=c.household_id AND n.category_id=c.id AND n.scope='category'
       WHERE c.household_id=$1 AND (cc.protected OR n.note IS NOT NULL)
       ORDER BY c.name`,
      [fam],
    );
    const from = opts.month ? `${opts.month}-01` : `${shiftMonth((await readToday(tx)).slice(0, 7), -11)}-01`;
    const to = opts.month ? `${shiftMonth(opts.month, 1)}-01` : null;
    const months = await tx.query<{ name: string; month: string; note: string }>(
      `SELECT c.name,to_char(n.month,'YYYY-MM') AS month,n.note
       FROM context_notes n JOIN categories c ON c.household_id=n.household_id AND c.id=n.category_id
       WHERE n.household_id=$1 AND n.scope='category_month' AND n.month>=$2::date
         AND ($3::date IS NULL OR n.month<$3::date)
       ORDER BY n.month,c.name`,
      [fam, from, to],
    );
    return {
      household: household.rows[0]?.note ?? null,
      categories: cats.rows,
      monthNotes: months.rows,
    };
  });
}

export async function saveNote(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => saveNoteTx(tx, user, raw));
}

// Parte transacional (também usada pela confirmação de prévia do chat).
export async function saveNoteTx(tx: Transaction, user: Identity, raw: unknown) {
  const input = saveSchema.parse(raw);
  const cat = input.category ? await categoryId(tx, user.familyId, input.category) : null;
  const month = input.month ? `${input.month}-01` : null;
  await tx.query(
    `INSERT INTO context_notes(household_id,scope,category_id,month,note,created_by)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(household_id,scope,
       COALESCE(category_id,'00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(month,'0001-01-01'::date))
     DO UPDATE SET note=excluded.note,created_by=excluded.created_by,updated_at=now()`,
    [user.familyId, input.scope, cat, month, input.note, user.userId],
  );
  return { ok: true };
}

export async function deleteNote(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  const input = deleteSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const cat = input.category ? await categoryId(tx, user.familyId, input.category) : null;
    const month = input.month ? `${input.month}-01` : null;
    await tx.query(
      `DELETE FROM context_notes WHERE household_id=$1 AND scope=$2
       AND category_id IS NOT DISTINCT FROM $3::uuid AND month IS NOT DISTINCT FROM $4::date`,
      [user.familyId, input.scope, cat, month],
    );
    return { ok: true };
  });
}

export async function setProtected(db: Database, user: Identity, raw: unknown) {
  canWrite(user);
  return asUser(db, user.userId, (tx) => setProtectedTx(tx, user, raw));
}

export async function setProtectedTx(tx: Transaction, user: Identity, raw: unknown) {
  const input = protectSchema.parse(raw);
  const cat = await categoryId(tx, user.familyId, input.category);
  await tx.query(
    `INSERT INTO category_context(household_id,category_id,protected,updated_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(household_id,category_id) DO UPDATE
     SET protected=excluded.protected,updated_by=excluded.updated_by,updated_at=now()`,
    [user.familyId, cat, input.protected, user.userId],
  );
  return { category: input.category, protected: input.protected };
}

export type SobraPathsWire = Wire<SobraPaths | null>;

export type CategoryEveryday = {
  months: MonthFlow[];
  currentMonth: string;
  categories: CategoryMonth[];
  protectedNames: string[];
};

// Carregador único: meses fechados + atual e só o dia a dia (fora conta fixa
// conciliada e parcela de cartão). Compartilhado por readSobraPaths e pelas
// ferramentas da assistente.
async function loadEveryday(tx: Transaction, user: Identity): Promise<CategoryEveryday> {
  const today = await readToday(tx);
  const month = today.slice(0, 7);
  const scope = {
    familyId: user.familyId,
    from: shiftMonth(month, -11) + "-01",
    to: addDays(today, 1),
  };
  const spend = await readRealizedSpend(tx, scope);
  const flows = await readMonthFlows(tx, scope, spend);
  const fixed = await fixedEventIds(
    tx,
    user.familyId,
    spend.flatMap((s) => (s.eventId ? [s.eventId] : [])),
  );
  const everyday = spend.filter(
    (s) => !(s.eventId != null && fixed.has(s.eventId)) && s.installment !== true,
  );
  const prot = await tx.query<{ name: string }>(
    `SELECT c.name FROM category_context cc
     JOIN categories c ON c.household_id=cc.household_id AND c.id=cc.category_id
     WHERE cc.household_id=$1 AND cc.protected`,
    [user.familyId],
  );
  return {
    months: flows,
    currentMonth: month,
    categories: categoryByMonth(everyday, flows.map((m) => m.month)),
    protectedNames: prot.rows.map((r) => r.name),
  };
}

export async function readCategoryEveryday(
  db: Database,
  user: Identity,
): Promise<CategoryEveryday> {
  return asUser(db, user.userId, (tx) => loadEveryday(tx, user));
}

// Só o dia a dia: fora conta fixa (evento conciliado) e parcela de cartão.
export async function readSobraPaths(
  db: Database,
  user: Identity,
  raw: unknown,
): Promise<SobraPaths | null> {
  const input = pathsSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const d = await loadEveryday(tx, user);
    return sobraPaths({
      months: d.months,
      categories: d.categories,
      protectedNames: new Set(d.protectedNames),
      currentMonth: d.currentMonth,
      target: input.pct !== undefined ? { pct: input.pct } : { cents: BigInt(input.cents!) },
    });
  });
}
