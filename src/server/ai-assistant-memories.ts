// Repositório da memória do assistente (SPEC-JUDITE-MEMORIA). Toda leitura e
// escrita é da casa autenticada (RLS + household_id). Esquecer é arquivar.
import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { canWrite } from "./reserves.ts";
import { maskLongNumbers } from "../domain/format.ts";
import { MEMORY_KINDS, generalRecall, normalizeTopics, orQuery, searchDoc, type MemoryKind } from "../domain/memory-search.ts";

export const MAX_ACTIVE = 200;
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

export const memoryInput = z
  .object({
    kind: z.enum(MEMORY_KINDS),
    text: z.string().trim().min(1).max(600),
    context: z.string().trim().min(1).max(300),
    topics: z.array(z.string().trim().min(1).max(40)).max(8),
    category: z.string().trim().min(1).max(120).nullable(),
    as_of: day,
    effective_from: day.nullable(),
    effective_until: day.nullable(),
    replaces: z.uuid().nullable(),
  })
  .strict()
  .refine((m) => !m.effective_from || !m.effective_until || m.effective_until >= m.effective_from, {
    message: "O fim da vigência não pode vir antes do começo.",
  });
export type MemoryInput = z.infer<typeof memoryInput>;

/** O conteúdo exato que a prévia mostra e a confirmação grava. */
export function sanitizeMemory(m: MemoryInput): MemoryInput {
  return {
    ...m,
    text: maskLongNumbers(m.text),
    context: maskLongNumbers(m.context),
    topics: normalizeTopics(m.topics.map(maskLongNumbers)),
  };
}

export type MemoryRow = {
  id: string;
  kind: MemoryKind;
  text: string;
  context: string;
  topics: string[];
  category: string | null;
  as_of: string;
  effective_from: string | null;
  effective_until: string | null;
  created_at: string;
  rank: number | null;
};

const COLUMNS = `m.id,m.kind,m.text,m.context,m.topics,c.name AS category,m.as_of::text,
  m.effective_from::text,m.effective_until::text,m.created_at::text`;
const FROM = `FROM ai_assistant_memories m
  LEFT JOIN categories c ON c.household_id=m.household_id AND c.id=m.category_id`;

export type SearchInput = {
  consulta?: string;
  temas?: string[];
  tipo?: MemoryKind;
  categoria?: string;
  limite: number;
};
export type SearchResult = { match: "text" | "topics" | "recent" | "none"; rows: MemoryRow[]; active: number };

/** Busca nas memórias ativas: texto (stemmer português), depois temas, depois recentes. */
export async function searchMemories(db: Database, user: Identity, p: SearchInput): Promise<SearchResult> {
  return asUser(db, user.userId, async (tx) => {
    const temas = p.temas ? normalizeTopics(p.temas) : [];
    // Categoria pelos temas: a gravação sempre põe o nome da categoria nos
    // temas, e uma memória sobre Delivery sem category_id também conta.
    const filters = (first: number) => ({
      sql: `m.household_id=$1 AND m.archived_at IS NULL
        AND ($${first}::text IS NULL OR m.kind=$${first})
        AND ($${first + 1}::text IS NULL OR $${first + 1} = ANY(m.topics))`,
      args: [p.tipo ?? null, p.categoria ? normalizeTopics([p.categoria])[0] : null],
    });
    const active = await activeCount(tx, user.familyId);
    // Qualquer termo da consulta basta (OU); quem tem mais termos sobe no
    // ranking. Com E, "limite do delivery" não achava "Delivery até R$ 600".
    const consulta = p.consulta ? orQuery(p.consulta) : "";
    if (consulta) {
      const f = filters(4);
      const rows = (
        await tx.query<MemoryRow>(
          `SELECT ${COLUMNS},ts_rank(m.search,q)::float AS rank
           ${FROM}, to_tsquery('portuguese',$2) q
           WHERE ${f.sql} AND m.search @@ q AND (cardinality($3::text[])=0 OR m.topics && $3::text[])
           ORDER BY rank DESC,m.created_at DESC LIMIT ${p.limite}`,
          [user.familyId, consulta, temas, ...f.args],
        )
      ).rows;
      if (rows.length) return { match: "text", rows, active };
    }
    // Consulta com assunto que não casou (ou só ruído): sem temas, nada de
    // memória aleatória. Pedido geral ("o que combinamos?") cai nas recentes.
    if (p.consulta && !temas.length && !generalRecall(p.consulta)) return { match: "none", rows: [], active };
    const f = filters(3);
    const rows = (
      await tx.query<MemoryRow>(
        `SELECT ${COLUMNS},NULL::float AS rank ${FROM}
         WHERE ${f.sql} AND (cardinality($2::text[])=0 OR m.topics && $2::text[])
         ORDER BY m.created_at DESC LIMIT ${p.limite}`,
        [user.familyId, temas, ...f.args],
      )
    ).rows;
    return { match: temas.length ? "topics" : "recent", rows, active };
  });
}

/** Contagem por tipo e os temas mais usados, para os fatos base (sem texto). */
export async function memorySummary(db: Database, user: Identity) {
  return asUser(db, user.userId, async (tx) => {
    const kinds = (
      await tx.query<{ kind: MemoryKind; n: number }>(
        `SELECT kind,count(*)::int AS n FROM ai_assistant_memories
         WHERE household_id=$1 AND archived_at IS NULL GROUP BY kind ORDER BY kind`,
        [user.familyId],
      )
    ).rows;
    const topics = (
      await tx.query<{ topic: string }>(
        `SELECT t AS topic FROM ai_assistant_memories, unnest(topics) t
         WHERE household_id=$1 AND archived_at IS NULL
         GROUP BY t ORDER BY count(*) DESC,t LIMIT 10`,
        [user.familyId],
      )
    ).rows;
    return { por_tipo: Object.fromEntries(kinds.map((k) => [k.kind, k.n])), temas: topics.map((t) => t.topic) };
  });
}

async function lock(tx: Transaction, familyId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [familyId + "memory"]);
}

async function activeCount(tx: Transaction, familyId: string): Promise<number> {
  return (
    await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ai_assistant_memories WHERE household_id=$1 AND archived_at IS NULL",
      [familyId],
    )
  ).rows[0].n;
}

/** Na prévia: recusar antes de mostrar o cartão se não cabe uma memória nova. */
export async function assertRoomForNew(db: Database, user: Identity) {
  const n = await asUser(db, user.userId, (tx) => activeCount(tx, user.familyId));
  if (n >= MAX_ACTIVE)
    throw new UserError(
      `A memória já tem ${MAX_ACTIVE} registros ativos. Escolha uma memória para esquecer ou atualize uma existente.`,
    );
}

/** Arquiva uma memória ativa da casa; sem linha afetada, recusa. */
async function archiveActive(tx: Transaction, familyId: string, id: string) {
  const r = await tx.query(
    "UPDATE ai_assistant_memories SET archived_at=now() WHERE id=$1 AND household_id=$2 AND archived_at IS NULL",
    [id, familyId],
  );
  if (!r.affectedRows) throw new UserError("Essa memória já foi atualizada ou arquivada.");
}

/** Grava (ou substitui) uma memória. Parte transacional da confirmação do chat. */
export async function saveMemoryTx(tx: Transaction, user: Identity, raw: unknown) {
  canWrite(user);
  const m = sanitizeMemory(memoryInput.parse(raw));
  await lock(tx, user.familyId);
  let categoryId: string | null = null;
  if (m.category) {
    const c = await tx.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [
      user.familyId,
      m.category,
    ]);
    if (!c.rows[0]) throw new UserError("Categoria não encontrada.");
    categoryId = c.rows[0].id;
  }
  if (m.replaces) await archiveActive(tx, user.familyId, m.replaces);
  else {
    const active = await activeCount(tx, user.familyId);
    if (active >= MAX_ACTIVE)
      throw new UserError(
        `A memória já tem ${MAX_ACTIVE} registros ativos. Escolha uma memória para esquecer ou atualize uma existente.`,
      );
  }
  const topics = normalizeTopics([...m.topics, ...(m.category ? [m.category] : [])]);
  const id = (
    await tx.query<{ id: string }>(
      `INSERT INTO ai_assistant_memories(household_id,kind,text,context,topics,category_id,as_of,
         effective_from,effective_until,search_doc,replaces,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        user.familyId,
        m.kind,
        m.text,
        m.context,
        topics,
        categoryId,
        m.as_of,
        m.effective_from,
        m.effective_until,
        searchDoc({ topics, text: m.text, context: m.context }),
        m.replaces,
        user.userId,
      ],
    )
  ).rows[0].id;
  // Sem texto nem contexto no log: o conteúdo já está na tabela.
  await recordAudit(tx, user.familyId, user.userId, "ai_memory.save", id, { kind: m.kind, replaces: m.replaces });
  return { id };
}

/** Grava uma memória já revisada pela pessoa, fora do chat (POST /api/memories). Mesmas regras de saveMemoryTx. */
export async function saveMemory(db: Database, user: Identity, raw: unknown) {
  return asUser(db, user.userId, (tx) => saveMemoryTx(tx, user, raw));
}

export async function archiveMemoryTx(tx: Transaction, user: Identity, raw: unknown) {
  canWrite(user);
  const { id } = z.object({ id: z.uuid() }).strict().parse(raw);
  await lock(tx, user.familyId);
  await archiveActive(tx, user.familyId, id);
  await recordAudit(tx, user.familyId, user.userId, "ai_memory.forget", id);
  return { id };
}
