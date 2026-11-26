"use client";
import { IconButton } from "../../../ds/index.ts";
import { Row } from "../../../ds/row.tsx";
import { StatusChip } from "../../../ds/status-chip.tsx";
import { CategoryIcon } from "../../../family-categories.tsx";
import { categoryColor } from "../../../../src/domain/category-color.ts";
import { movementCount, type Action, type Category, type Tag } from "../fixture.ts";
import { TagCombobox } from "./tag-combobox.tsx";

/** Uma categoria: linha do DS e, logo abaixo, a caixa com as etiquetas como chips. */
export function CategoryBlock({
  category,
  reader,
  flashKey,
  initialOpen,
  initialQuery,
  placeholder,
  dispatch,
  onFlash,
  onEdit,
  onAskDelete,
}: {
  category: Category;
  reader: boolean;
  /** Nome (normalizado) da etiqueta recém-salva, para o chip mostrar o destaque. */
  flashKey: string | null;
  initialOpen?: boolean;
  initialQuery?: string;
  placeholder?: string;
  dispatch: (a: Action) => void;
  onFlash: (name: string) => void;
  onEdit: () => void;
  onAskDelete: (c: Category, t: Tag) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="ds-list list gap-0">
        <Row
          icon={<CategoryIcon name={category.name} />}
          catColor={categoryColor(category.name)}
          title={category.name}
          sub={movementCount(category.movements)}
          trail={
            <span className="flex items-center gap-1">
              {category.essential ? <StatusChip tone="ok" label="Essencial" /> : null}
              {reader ? null : <IconButton icon="edit" size="sm" label={`Editar categoria ${category.name}`} onClick={onEdit} />}
            </span>
          }
        />
      </div>
      <TagCombobox
        label={`Etiquetas de ${category.name}`}
        tags={category.tags}
        chips={category.tags}
        readOnly={reader}
        flashKey={flashKey}
        placeholder={placeholder}
        initialOpen={initialOpen}
        initialQuery={initialQuery}
        onRemoveChip={(t) => onAskDelete(category, t)}
        onCreate={(name) => {
          dispatch({ type: "addTag", categoryId: category.id, name });
          onFlash(name);
        }}
        onRename={(t, name) => {
          dispatch({ type: "renameTag", categoryId: category.id, tagId: t.id, name });
          onFlash(name);
        }}
      />
    </div>
  );
}
