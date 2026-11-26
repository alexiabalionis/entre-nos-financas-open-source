/**
 * Dados fictícios e regras da vitrine de categorias e etiquetas. As regras
 * espelham o servidor (src/server/category-tags.ts): nome aparado, 1 a 120
 * caracteres, único na categoria sem diferenciar maiúsculas. Sem rede.
 */
export type Tag = { id: string; name: string; uses: number };
export type Category = {
  id: string;
  name: string;
  essential: boolean;
  movements: number;
  colorIndex: number;
  tags: Tag[];
};
export type Scenario = "normal" | "sem-etiquetas" | "vazio" | "leitura" | "duplicado" | "excluir";

export const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "sem-etiquetas", label: "Categoria sem etiquetas" },
  { value: "vazio", label: "Sem categorias" },
  { value: "leitura", label: "Somente leitura" },
  { value: "duplicado", label: "Nome repetido" },
  { value: "excluir", label: "Excluir etiqueta em uso" },
];

let seq = 0;
const id = () => "x" + ++seq;
const tag = (name: string, uses: number): Tag => ({ id: id(), name, uses });

export function initialCategories(s: Scenario): Category[] {
  if (s === "vazio") return [];
  return [
    { id: "c1", name: "Compras pessoais", essential: false, movements: 17, colorIndex: 0, tags: [tag("Vestuário", 12), tag("Presentes", 5), tag("Cosméticos", 0)] },
    { id: "c2", name: "Supermercado e feira", essential: true, movements: 24, colorIndex: 1, tags: [] },
    { id: "c3", name: "Casa", essential: true, movements: 9, colorIndex: 2, tags: [tag("Manutenção", 3), tag("Decoração", 2)] },
    { id: "c4", name: "Transporte", essential: true, movements: 14, colorIndex: 3, tags: [] },
    { id: "c5", name: "Lazer", essential: false, movements: 6, colorIndex: 4, tags: [tag("Cinema", 2), tag("Viagens", 4)] },
    { id: "c6", name: "Saúde", essential: true, movements: 3, colorIndex: 5, tags: [] },
  ];
}

const key = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

/** Mensagem de erro do nome, ou "" se válido. Bloqueia o envio; nunca corrige em silêncio. */
export function nameError(name: string, siblings: string[], kind: "tag" | "category"): string {
  const clean = name.trim();
  if (!clean) return "Informe um nome.";
  if (clean.length > 120) return "O nome pode ter no máximo 120 caracteres.";
  if (siblings.some((n) => key(n) === key(clean)))
    return kind === "tag"
      ? "Já existe uma etiqueta com esse nome nesta categoria."
      : "Já existe uma categoria com esse nome.";
  return "";
}

/** Texto da confirmação ao excluir etiqueta em uso. Sem uso, exclui direto. */
export function deleteMessage(category: Category, t: Tag): string {
  const n = t.uses === 1 ? "1 movimento fica" : `${t.uses} movimentos ficam`;
  return `${n} em ${category.name}, só sem a etiqueta ${t.name}. Nenhum valor muda.`;
}

export type Action =
  | { type: "reset"; categories: Category[] }
  | { type: "addCategory"; name: string; essential: boolean }
  | { type: "editCategory"; id: string; name: string; essential: boolean }
  | { type: "addTag"; categoryId: string; name: string }
  | { type: "renameTag"; categoryId: string; tagId: string; name: string }
  | { type: "deleteTag"; categoryId: string; tagId: string };

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");

export function reducer(state: Category[], a: Action): Category[] {
  const mapCat = (cid: string, f: (c: Category) => Category) => state.map((c) => (c.id === cid ? f(c) : c));
  switch (a.type) {
    case "reset":
      return a.categories;
    case "addCategory":
      return [...state, { id: id(), name: a.name.trim(), essential: a.essential, movements: 0, colorIndex: state.length % 12, tags: [] }].sort(byName);
    case "editCategory":
      return mapCat(a.id, (c) => ({ ...c, name: a.name.trim(), essential: a.essential })).sort(byName);
    case "addTag":
      return mapCat(a.categoryId, (c) => ({ ...c, tags: [...c.tags, tag(a.name.trim(), 0)].sort(byName) }));
    case "renameTag":
      return mapCat(a.categoryId, (c) => ({ ...c, tags: c.tags.map((t) => (t.id === a.tagId ? { ...t, name: a.name.trim() } : t)).sort(byName) }));
    case "deleteTag":
      return mapCat(a.categoryId, (c) => ({ ...c, tags: c.tags.filter((t) => t.id !== a.tagId) }));
  }
}

export const tagCount = (n: number) => (n === 0 ? "Sem etiquetas" : n === 1 ? "1 etiqueta" : `${n} etiquetas`);
export const movementCount = (n: number) => (n === 1 ? "1 movimento" : `${n} movimentos`);
export const INTRO = "Etiquetas ajudam a separar gastos dentro da categoria. Os totais continuam os mesmos.";
