"use client";
import { Icon } from "../../../ds/index.ts";
import { cx } from "../../../ds/shared.ts";
import type { Tag } from "../fixture.ts";
import { TagEditForm } from "./tag-edit-form.tsx";
import { usesLabel, type TagOption } from "./tag-search.ts";

const row = "flex items-center gap-2 rounded-box px-3 py-1.5 hover:bg-base-200";

/** Lista de opções do campo: escolher, criar ou renomear na própria linha. */
export function TagListbox({
  id,
  options,
  activeIndex,
  tags,
  chipIds,
  editingId,
  onChoose,
  onEdit,
  onSave,
  onCancel,
}: {
  id: string;
  options: TagOption[];
  activeIndex: number;
  tags: Tag[];
  chipIds: string[];
  editingId: string | null;
  onChoose: (o: TagOption) => void;
  onEdit: (t: Tag) => void;
  onSave: (t: Tag, name: string) => void;
  onCancel: () => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Etiquetas"
      className="menu mt-1 max-h-72 w-full flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 shadow-md"
    >
      {options.length === 0 ? (
        <li role="presentation" className="px-3 py-2 text-sm text-base-content/60">
          {tags.length === 0
            ? "Esta categoria ainda não tem etiquetas. Digite um nome para criar a primeira."
            : "Nenhuma etiqueta com esse nome."}
        </li>
      ) : null}
      {options.map((o, i) => {
        const active = i === activeIndex;
        if (o.kind === "create")
          return (
            <li key="create" id={`${id}-${i}`} role="option" aria-selected={active} className="p-0">
              <div
                className={cx(row, "cursor-pointer justify-start", active && "bg-base-200")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChoose(o)}
              >
                <Icon name="plus" size={14} />
                <span className="flex-1 truncate font-normal">Criar etiqueta “{o.name}”</span>
              </div>
            </li>
          );
        const t = o.tag;
        if (t.id === editingId)
          return (
            <li key={t.id} role="presentation" className="p-0">
              <TagEditForm
                tag={t}
                siblings={tags.filter((x) => x.id !== t.id).map((x) => x.name)}
                onSave={(name) => onSave(t, name)}
                onCancel={onCancel}
              />
            </li>
          );
        return (
          <li key={t.id} id={`${id}-${i}`} role="option" aria-selected={chipIds.includes(t.id)} className="p-0">
            <div
              className={cx(row, "cursor-pointer", active && "bg-base-200")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChoose(o)}
            >
              <span className="flex-1 truncate font-normal">{t.name}</span>
              <small className="text-xs text-base-content/60">{usesLabel(t.uses)}</small>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle"
                aria-label={`Renomear etiqueta ${t.name}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(t);
                }}
              >
                <Icon name="edit" size={14} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
