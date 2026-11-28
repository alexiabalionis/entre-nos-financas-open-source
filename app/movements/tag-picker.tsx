"use client";
import { ChipField, type ChipItem } from "../ds/chip-field";
import {
  TAG_TEXT,
  nameError,
  tagCreateLabel,
  usesLabel,
} from "../space/categories/categories-model.ts";

type PickerCategory = {
  id: string;
  tags: { id: string; name: string; uses: number }[];
};

/** Escolha única de etiqueta da categoria, usada no diálogo "Categorizar transação". */
export function TagPicker({
  category,
  chosen,
  busy,
  onChange,
  createTag,
}: {
  category: PickerCategory;
  chosen: ChipItem | null;
  busy: boolean;
  onChange: (tag: ChipItem | null) => void;
  createTag: (categoryId: string, name: string) => Promise<ChipItem>;
}) {
  const items: ChipItem[] = category.tags.map((t) => ({
    id: t.id,
    name: t.name,
    meta: usesLabel(t.uses),
  }));
  if (chosen && !items.some((i) => i.id === chosen.id))
    items.push({ ...chosen, meta: usesLabel(0) });
  return (
    <div className="field flex min-w-0 flex-col gap-1.5">
      <span className="text-[0.8125rem] leading-snug font-medium text-ink" aria-hidden="true">
        Etiqueta (opcional)
      </span>
      <ChipField
        label="Etiqueta (opcional)"
        placeholder="Escolher ou criar etiqueta"
        items={items}
        chips={chosen ? [chosen] : []}
        text={TAG_TEXT}
        busy={busy}
        createLabel={tagCreateLabel}
        removeLabel={(name) => `Tirar etiqueta ${name}`}
        renameLabel={(name) => `Renomear etiqueta ${name}`}
        validate={(name) =>
          nameError(
            name,
            items.map((i) => i.name),
            "tag",
          )
        }
        onPick={(item) => onChange(item)}
        onRemoveChip={() => onChange(null)}
        onCreate={async (name) => {
          try {
            onChange(await createTag(category.id, name.trim()));
          } catch (err) {
            return err instanceof Error
              ? err.message
              : "Não foi possível criar a etiqueta.";
          }
        }}
      />
    </div>
  );
}
