"use client";
import { Icon } from "../../../ds/index.ts";
import { cx } from "../../../ds/shared.ts";
import type { Tag } from "../fixture.ts";

/** Chip da caixa: o nome e, dentro dele, o x. Sem `onRemove` não há x. */
export function TagChip({
  tag,
  flashed,
  onRemove,
  removeLabel,
}: {
  tag: Tag;
  flashed: boolean;
  onRemove?: (t: Tag) => void;
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
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle -mr-1 text-base-content/60"
          data-chip-x=""
          aria-label={removeLabel(tag.name)}
          onClick={(e) => {
            // O clique no x não pode passar para a caixa (abrir a lista ou focar o campo).
            e.preventDefault();
            e.stopPropagation();
            onRemove(tag);
          }}
        >
          <Icon name="close" size={10} />
        </button>
      ) : null}
    </span>
  );
}
