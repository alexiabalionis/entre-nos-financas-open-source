"use client";
import type { ReactNode } from "react";

type DisclosureProps = {
  /** Texto do gatilho (summary). */
  summary: ReactNode;
  /** Começa aberto. */
  open?: boolean;
  children: ReactNode;
};

/**
 * Bloco colapsável nativo (details/summary): acessível de graça, sem estado
 * controlado. Usa o `collapse` do daisyUI no details; a setinha ↓/↑ (texto) e
 * o estilo do gatilho continuam no family.css, por isso sem `collapse-arrow`.
 */
export function Disclosure({ summary, open, children }: DisclosureProps) {
  return (
    <details className="ds-disc collapse collapse-arrow" open={open}>
      <summary className="collapse-title">{summary}</summary>
      <div className="collapse-content">{children}</div>
    </details>
  );
}
