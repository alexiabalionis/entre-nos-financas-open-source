// Prévias de memória no chat (SPEC-JUDITE-MEMORIA): memory_save e
// memory_forget. A prévia mostra exatamente o que a confirmação grava.
import { z } from "zod";
import type { Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { assertRoomForNew, sanitizeMemory, memoryInput } from "./ai-assistant-memories.ts";
import { settledToday } from "./bank-settled.ts";
import { brDate } from "../domain/format.ts";
import { MEMORY_KINDS, type MemoryKind } from "../domain/memory-search.ts";

const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}\\d+$`));

export const memoryIntents = [
  z
    .object({
      type: z.literal("memory_save"),
      kind: z.enum(MEMORY_KINDS),
      text: z.string().trim().min(1).max(600),
      context: z.string().trim().min(1).max(300),
      topics: z.array(z.string().trim().min(1).max(40)).max(8),
      category: ref("c").nullable(),
      as_of: day.nullable().optional(),
      effective_from: day.nullable().optional(),
      effective_until: day.nullable().optional(),
      replaces: ref("m").nullable(),
    })
    .strict(),
  z.object({ type: z.literal("memory_forget"), memory: ref("m") }).strict(),
] as const;
type SaveIntent = z.infer<(typeof memoryIntents)[0]>;
type ForgetIntent = z.infer<(typeof memoryIntents)[1]>;

/** O que a prévia precisa resolver: categorias do catálogo e memórias lidas nesta pergunta. */
export type MemoryCatalog = {
  categories: { name: string }[];
  memoryRefs?: ReadonlyMap<string, { id: string; text: string }>;
};

const KIND_LABEL: Record<MemoryKind, string> = {
  diagnostico: "Diagnóstico",
  combinado: "Combinado",
  objetivo: "Objetivo",
  aprendizado: "Aprendizado",
};

function memoryRef(c: MemoryCatalog, value: string) {
  const m = c.memoryRefs?.get(value);
  if (!m) throw new UserError("Não identifiquei essa memória. Peça para a Judite procurar de novo.");
  return m;
}

export async function memoryPayload(db: Database, user: Identity, a: SaveIntent | ForgetIntent, c: MemoryCatalog) {
  if (a.type === "memory_forget") {
    const m = memoryRef(c, a.memory);
    return {
      operation: "memory_forget",
      data: { id: m.id },
      view: {
        title: "Esquecer esta memória",
        details: [
          `Memória: ${m.text}`,
          "A memória deixa de ser considerada nas próximas respostas. Ela continuará registrada no histórico.",
        ],
      },
    };
  }
  const today = settledToday();
  const asOf = a.as_of ?? today;
  if (asOf > today) throw new UserError("A data de referência não pode estar no futuro.");
  const category = a.category ? c.categories[Number(a.category.slice(1))]?.name : null;
  if (a.category && !category) throw new UserError("Não identifiquei a categoria. Diga o nome exato.");
  const old = a.replaces ? memoryRef(c, a.replaces) : null;
  if (!old) await assertRoomForNew(db, user);
  // Mesma validação e sanitização da gravação: a prévia é o que será salvo.
  const data = sanitizeMemory(
    memoryInput.parse({
      kind: a.kind,
      text: a.text,
      context: a.context,
      topics: a.topics,
      category: category ?? null,
      as_of: asOf,
      effective_from: a.effective_from ?? null,
      effective_until: a.effective_until ?? null,
      replaces: old?.id ?? null,
    }),
  );
  const range = [
    data.effective_from ? `de ${brDate(data.effective_from)}` : "",
    data.effective_until ? `até ${brDate(data.effective_until)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const vigencia = range ? `Vigência: ${range}` : null;
  return {
    operation: "memory_save",
    data,
    view: {
      title: old ? "Atualizar memória" : "Guardar na memória",
      details: [
        `Tipo: ${KIND_LABEL[data.kind]}`,
        ...(data.category ? [`Categoria: ${data.category}`] : []),
        `Texto: ${data.text}`,
        `Contexto: ${data.context}`,
        ...(data.topics.length ? [`Temas: ${data.topics.join(", ")}`] : []),
        `Referência: ${brDate(data.as_of)}`,
        ...(vigencia ? [vigencia] : []),
        ...(old ? [`Substitui: ${old.text}`] : []),
        "Fica guardado para vocês dois. Não altera valores.",
      ],
    },
  };
}
