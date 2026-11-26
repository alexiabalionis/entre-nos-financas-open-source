export type ChipItem = {
  id: string;
  name: string;
  /** Texto discreto à direita do item na lista. */
  meta?: string;
};

/** Texto sem maiúsculas nem acentos, para comparar e filtrar. */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

export type ChipOption =
  | { kind: "item"; item: ChipItem }
  | { kind: "create"; name: string };

export type ChipSearch = {
  options: ChipOption[];
  /** Item cujo nome é igual ao texto digitado (nunca se cria duplicado). */
  exact: ChipItem | undefined;
  /** Erro do texto digitado, vindo do `validate` de quem chama. */
  error: string;
};

/** Opções da lista: itens que casam com o texto e, no fim, "criar" se for nome novo. */
export function searchChips(
  items: ChipItem[],
  query: string,
  validate?: (name: string) => string,
): ChipSearch {
  const q = norm(query);
  const clean = query.trim();
  const exact = q ? items.find((i) => norm(i.name) === q) : undefined;
  const options: ChipOption[] = items
    .filter((i) => norm(i.name).includes(q))
    .map((item) => ({ kind: "item", item }));
  const error = clean && !exact && validate ? validate(clean) : "";
  if (clean && !exact && !error) options.push({ kind: "create", name: clean });
  return { options, exact, error };
}

/** Opção ativa quando a pessoa ainda não usou as setas: a repetida, ou a de criar. */
export function defaultActive({ options, exact }: ChipSearch, query: string): number {
  if (!query.trim()) return -1;
  if (exact)
    return options.findIndex((o) => o.kind === "item" && o.item.id === exact.id);
  return options.findIndex((o) => o.kind === "create");
}
