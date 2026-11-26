"use client";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";
import { ChipFieldEdit } from "./chip-field-edit.tsx";
import type { ChipItem, ChipOption } from "./chip-field-search.ts";

const row = "flex items-center gap-2 rounded-box px-3 py-1.5 hover:bg-base-200";

/** Textos fixos da lista e da linha de renomear; vêm de quem usa o campo. */
export type ChipFieldListText = {
  /** aria-label da lista. */
  list: string;
  /** Lista sem nenhum item. */
  empty: string;
  /** Texto digitado que não casa com nenhum item. */
  noMatch: string;
  saveLabel: string;
  cancelLabel: string;
  createLabel: (name: string) => string;
  renameLabel: (name: string) => string;
  /** aria-label do campo de renomear. */
  renameFieldLabel: (name: string) => string;
};

/** Lista de opções do campo: escolher, criar ou renomear na própria linha. */
export function ChipFieldList({
  id,
  options,
  activeIndex,
  itemCount,
  chipIds,
  editingId,
  text,
  canRename,
  busy,
  editError,
  validate,
  onChoose,
  onEdit,
  onSave,
  onCancel,
}: {
  id: string;
  options: ChipOption[];
  activeIndex: number;
  itemCount: number;
  chipIds: string[];
  editingId: string | null;
  text: ChipFieldListText;
  canRename: boolean;
  busy?: boolean;
  editError: string;
  validate?: (name: string, exceptId?: string) => string;
  onChoose: (o: ChipOption) => void;
  onEdit: (item: ChipItem) => void;
  onSave: (item: ChipItem, name: string) => void;
  onCancel: () => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={text.list}
      className="menu mt-1 max-h-72 w-full flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 shadow-md"
    >
      {options.length === 0 ? (
        <li role="presentation" className="px-3 py-2 text-sm text-base-content/60">
          {itemCount === 0 ? text.empty : text.noMatch}
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
                <span className="flex-1 truncate font-normal">{text.createLabel(o.name)}</span>
              </div>
            </li>
          );
        const item = o.item;
        if (item.id === editingId)
          return (
            <li key={item.id} role="presentation" className="p-0">
              <ChipFieldEdit
                item={item}
                fieldLabel={text.renameFieldLabel(item.name)}
                saveLabel={text.saveLabel}
                cancelLabel={text.cancelLabel}
                validate={validate}
                serverError={editError}
                busy={busy}
                onSave={(name) => onSave(item, name)}
                onCancel={onCancel}
              />
            </li>
          );
        return (
          <li key={item.id} id={`${id}-${i}`} role="option" aria-selected={chipIds.includes(item.id)} className="p-0">
            <div
              className={cx(row, "cursor-pointer", active && "bg-base-200")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChoose(o)}
            >
              <span className="flex-1 truncate font-normal">{item.name}</span>
              {item.meta ? <small className="text-xs text-base-content/60">{item.meta}</small> : null}
              {canRename ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-circle"
                  aria-label={text.renameLabel(item.name)}
                  disabled={busy}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(item);
                  }}
                >
                  <Icon name="edit" size={14} />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
