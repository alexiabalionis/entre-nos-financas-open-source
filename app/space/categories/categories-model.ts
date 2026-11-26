import { norm, type ChipItem } from "../../ds/chip-field-search.ts";
import type { ChipFieldText } from "../../ds/chip-field.tsx";

export type CategoryTag = { id: string; name: string; uses: number };
export type SpaceCategory = {
  id: string;
  name: string;
  essential: boolean;
  tags: CategoryTag[];
};

const MAX_NAME = 120;

/** Mensagem de erro do nome, ou "" se válido. Bloqueia o envio; nunca corrige em silêncio. */
export function nameError(name: string, siblings: string[], kind: "tag" | "category"): string {
  const clean = name.trim();
  if (!clean) return "Informe um nome.";
  if (clean.length > MAX_NAME) return `O nome pode ter no máximo ${MAX_NAME} caracteres.`;
  if (siblings.some((n) => norm(n) === norm(clean)))
    return kind === "tag"
      ? "Já existe uma etiqueta com esse nome nesta categoria."
      : "Já existe uma categoria com esse nome.";
  return "";
}

/** Texto da confirmação ao excluir etiqueta em uso. Sem uso, exclui direto. */
export function deleteMessage(category: SpaceCategory, t: CategoryTag): string {
  const n = t.uses === 1 ? "1 movimento fica" : `${t.uses} movimentos ficam`;
  return `${n} em ${category.name}, só sem a etiqueta ${t.name}. Nenhum valor muda.`;
}

export const tagCount = (n: number) =>
  n === 0 ? "Sem etiquetas" : n === 1 ? "1 etiqueta" : `${n} etiquetas`;

export const categoryCount = (n: number) => (n === 1 ? "1 categoria" : `${n} categorias`);

export const usesLabel = (uses: number) =>
  uses === 0 ? "Ainda sem movimentos" : uses === 1 ? "1 movimento" : `${uses} movimentos`;

export const INTRO = "Etiquetas ajudam a separar gastos dentro da categoria. Os totais continuam os mesmos.";

export const toItems = (tags: CategoryTag[]): ChipItem[] =>
  tags.map((t) => ({ id: t.id, name: t.name, meta: usesLabel(t.uses) }));

export const TAG_TEXT: ChipFieldText = {
  list: "Etiquetas",
  empty: "Esta categoria ainda não tem etiquetas. Digite um nome para criar a primeira.",
  noMatch: "Nenhuma etiqueta com esse nome.",
  none: "Sem etiquetas ainda.",
  openLabel: "Abrir lista de etiquetas",
  closeLabel: "Fechar lista de etiquetas",
  saveLabel: "Salvar nome",
  cancelLabel: "Cancelar",
  renameFieldLabel: (name) => `Novo nome da etiqueta ${name}`,
};

export const tagCreateLabel = (name: string) => `Criar etiqueta “${name}”`;
export const tagRemoveLabel = (name: string) => `Excluir etiqueta ${name}`;
export const tagRenameLabel = (name: string) => `Renomear etiqueta ${name}`;
