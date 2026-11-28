"use client";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";

type DisclosureProps = {
  /** Texto do gatilho (summary). */
  summary: ReactNode;
  /** Começa aberto. */
  open?: boolean;
  children: ReactNode;
};

/**
 * Bloco colapsável nativo (details/summary): acessível sem estado controlado.
 */
export function Disclosure({ summary, open, children }: DisclosureProps) {
  return (
    <details
      className="ds-disc group mt-3 rounded-2xl border border-border bg-surface"
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <Icon
          name="down"
          size={16}
          className="shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}
