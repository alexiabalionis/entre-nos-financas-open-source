import { nameError, type Tag } from "../fixture.ts";

/** Texto sem maiúsculas nem acentos, para comparar e filtrar. */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

export type TagOption = { kind: "tag"; tag: Tag } | { kind: "create"; name: string };

export type Search = {
  options: TagOption[];
  /** Etiqueta cujo nome é igual ao texto digitado (nunca se cria duplicada). */
  exact: Tag | undefined;
  /** Erro do texto digitado (só o limite de tamanho; repetida vira destaque). */
  error: string;
};

/** Opções da lista: etiquetas que casam com o texto e, no fim, "Criar" se for nome novo. */
export function searchTags(tags: Tag[], query: string): Search {
  const q = norm(query);
  const clean = query.trim();
  const exact = q ? tags.find((t) => norm(t.name) === q) : undefined;
  const options: TagOption[] = tags.filter((t) => norm(t.name).includes(q)).map((tag) => ({ kind: "tag", tag }));
  const error = clean.length > 120 ? nameError(clean, [], "tag") : "";
  if (clean && !exact && !error) options.push({ kind: "create", name: clean });
  return { options, exact, error };
}

/** Opção ativa quando a pessoa ainda não usou as setas: a repetida, ou a de criar. */
export function defaultActive({ options, exact }: Search, query: string): number {
  if (!query.trim()) return -1;
  if (exact) return options.findIndex((o) => o.kind === "tag" && o.tag.id === exact.id);
  return options.findIndex((o) => o.kind === "create");
}

export const usesLabel = (uses: number) =>
  uses === 0 ? "Ainda sem movimentos" : uses === 1 ? "1 movimento" : `${uses} movimentos`;
