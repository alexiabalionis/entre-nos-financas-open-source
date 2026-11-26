"use client";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";
import type { ChipItem } from "./chip-field-search.ts";

/** Chip da caixa: o nome e, dentro dele, o x. Sem `onRemove` não há x. */
export function ChipFieldChip({
  item,
  flashed,
  disabled,
  onRemove,
  removeLabel,
}: {
  item: ChipItem;
  flashed: boolean;
  disabled?: boolean;
  onRemove?: (item: ChipItem) => void;
  removeLabel: (name: string) => string;
}) {
  return (
    <span
      className={cx(
        "ds-chip badge badge-sm rounded-full",
        flashed ? "badge-soft badge-success" : "badge-outline",
        onRemove && "pr-1",
      )}
    >
      {item.name}
      {onRemove ? (
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle -mr-1 text-base-content/60"
          data-chip-x=""
          aria-label={removeLabel(item.name)}
          disabled={disabled}
          onClick={(e) => {
            // O clique no x não pode passar para a caixa (abrir a lista ou focar o campo).
            e.preventDefault();
            e.stopPropagation();
            onRemove(item);
          }}
        >
          <Icon name="close" size={10} />
        </button>
      ) : null}
    </span>
  );
}
