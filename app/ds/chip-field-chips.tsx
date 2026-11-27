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
        "ds-chip inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        flashed ? "border-ok/30 bg-ok-bg text-ok" : "border-border bg-surface-2 text-ink",
        onRemove && "pr-1",
      )}
    >
      {item.name}
      {onRemove ? (
        <button
          type="button"
          className="ui-reset-btn -mr-1 inline-flex size-4 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink cursor-pointer"
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
