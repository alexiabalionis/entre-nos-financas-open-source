"use client";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

/**
 * Cabeçalho que abre e fecha um bloco (use com o Collapse do DS): a linha toda
 * é o alvo, com uma seta discreta à direita que gira quando aberto. O conteúdo
 * do cabeçalho é livre (título, valor, frase). `action` é o que o leitor de
 * tela ouve além do conteúdo (ex.: "Ver itens da fatura"); fechado e aberto
 * podem ter textos diferentes.
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
  /** id do bloco que abre e fecha. */
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
      className={cx("ds-discbtn btn btn-ghost group h-auto w-full justify-between py-2 text-left", className)}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {children}
      <span className="ds-discbtn-icon transition-transform group-aria-expanded:rotate-180" aria-hidden>
        <Icon name="down" size={iconSize} />
      </span>
      {action ? <span className="sr-only">{expanded ? action.close : action.open}</span> : null}
    </button>
  );
}
