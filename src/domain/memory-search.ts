// Normalização da memória do assistente (SPEC-JUDITE-MEMORIA). O PGlite não
// tem `unaccent`: tirar acento e caixa aqui, igual na gravação e na busca, é o
// que faz "Redução" achar "reducao". O stemmer português fica com o Postgres.

/** Minúsculas, sem diacríticos, espaços únicos. Determinística. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_TOPICS = 8;

/** Temas normalizados, sem repetição e sem vazios, até 8. */
export function normalizeTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map(normalizeSearch).filter(Boolean))].slice(0, MAX_TOPICS);
}

/** Base da busca textual: temas, texto e contexto já normalizados. */
export function searchDoc(p: { topics: readonly string[]; text: string; context: string }): string {
  return normalizeSearch([...p.topics, p.text, p.context].join(" "));
}

// Palavras de pergunta que o dicionário português do Postgres não descarta e
// que, pelo radical, casam com conteúdo ("sobre" e "sobrar" viram "sobr").
// Verbos de recordar também ficam de fora: "o que combinamos sobre delivery"
// casava com TODO combinado ("Combinamos limitar..."); o assunto é "delivery".
const QUESTION_WORDS = new Set(
  [
    "que de da do das dos com em no na um uma ou se ja tudo",
    "sobre qual quais quanto quanta quantos quantas como onde quando porque pra para gente nos nosso nossa nossos nossas voces era eram foi foram esta estamos isso esse essa ai ate agora antes",
    "combinamos combinou combinaram combinado combinados combinada combinar combinei decidimos decidiu decidiram decidido decidir",
    "dizia diziamos disse dissemos dito falamos falava falavamos falou lembra lembram lembro lembrar ficou tinha tinhamos",
  ]
    .join(" ")
    .split(" "),
);

/**
 * Consulta "qualquer termo" para to_tsquery: só letras e dígitos, termos
 * unidos por |. O texto do modelo nunca chega cru ao parser do tsquery.
 */
export function orQuery(consulta: string): string {
  return normalizeSearch(consulta)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !QUESTION_WORDS.has(t))
    .slice(0, 12)
    .join(" | ");
}

/**
 * "O que a gente combinou e decidiu?": a consulta tem palavras, todas de
 * pergunta ou de recordar. É um pedido geral (cai nas recentes), não ruído.
 */
export function generalRecall(consulta: string): boolean {
  const words = normalizeSearch(consulta)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  return words.length > 0 && words.every((t) => QUESTION_WORDS.has(t));
}

export type MemoryKind = "diagnostico" | "combinado" | "objetivo" | "aprendizado";
export const MEMORY_KINDS = ["diagnostico", "combinado", "objetivo", "aprendizado"] as const;

const KIND_WORD: Record<MemoryKind, string> = {
  diagnostico: "diagnóstico",
  combinado: "combinado",
  objetivo: "objetivo",
  aprendizado: "aprendizado",
};

/** "R$ 600,00 (combinado em 01/12/2026)": um valor de memória nunca passa por atual. */
export function historicalMoney(value: string, kind: MemoryKind, asOf: string): string {
  const [y, m, d] = asOf.split("-");
  return `${value} (${KIND_WORD[kind]} em ${d}/${m}/${y})`;
}

/** Situação da vigência num dia: ainda não começou, vigente ou encerrada. */
export function validity(
  m: { effective_from: string | null; effective_until: string | null },
  today: string,
): "futura" | "vigente" | "encerrada" | null {
  if (m.effective_from === null && m.effective_until === null) return null;
  if (m.effective_from !== null && m.effective_from > today) return "futura";
  if (m.effective_until !== null && m.effective_until < today) return "encerrada";
  return "vigente";
}
