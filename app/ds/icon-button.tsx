"use client";
import { Icon } from "./icon.tsx";
import type { IconName } from "./icon.tsx";
import { cx } from "./shared";

/**
 * Botão quadrado só com ícone. O `label` vira aria-label (obrigatório) e a área
 * de toque tem sempre 44px. Não mostra texto nem tooltip.
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
        "ds-iconbtn btn btn-ghost btn-circle",
        size === "sm" && "is-sm btn-sm",
        pressed && "btn-active",
      )}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
