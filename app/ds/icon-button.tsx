"use client";
import { Icon } from "./icon.tsx";
import type { IconName } from "./icon.tsx";
import { cx } from "./shared";

/**
 * Botão circular só com ícone. O `label` vira aria-label (obrigatório).
 */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  size = "md",
  pressed,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "ds-iconbtn ui-icon-btn inline-flex shrink-0 items-center justify-center rounded-full border border-transparent transition-colors duration-150 cursor-pointer active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        size === "sm" ? "is-sm size-8.5" : "size-10 [@media(pointer:coarse)]:size-11",
        pressed
          ? "bg-accent-soft text-accent-ink border-accent/20"
          : "bg-transparent text-muted hover:bg-surface-2 hover:text-ink",
      )}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </button>
  );
}
