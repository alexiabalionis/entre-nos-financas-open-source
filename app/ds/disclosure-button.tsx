"use client";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

/**
 * Cabeçalho que abre e fecha um bloco (use com o Collapse do DS): a linha toda
 * é o alvo, com uma seta discreta à direita que gira quando aberto.
 */
export function DisclosureButton({
  expanded,
  controls,
  onToggle,
  children,
  action,
  className,
  iconSize = 18,
}: {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
  action?: { open: string; close: string };
  className?: string;
  iconSize?: number;
}) {
  return (
    <button
      type="button"
      className={cx(
        "ds-discbtn ui-btn group flex h-auto w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {children}
      <span
        className="ds-discbtn-icon shrink-0 text-muted transition-transform duration-200 group-aria-expanded:rotate-180"
        aria-hidden
      >
        <Icon name="down" size={iconSize} />
      </span>
      {action ? (
        <span className="sr-only">{expanded ? action.close : action.open}</span>
      ) : null}
    </button>
  );
}
