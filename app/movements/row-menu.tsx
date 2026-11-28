"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "../ds/shared.ts";

export type RowMenuItem = {
  label: string;
  icon: string;
  tone?: "danger";
  onSelect: () => void;
};

/**
 * Menu "⋯" no canto de uma linha de lista em Tailwind v4 puro.
 */
export function RowMenu({
  label,
  items,
}: {
  label: string;
  items: RowMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="row-menu absolute top-3 right-1.5 z-10" ref={root}>
      <button
        type="button"
        className="row-menu-trigger ui-icon-btn inline-flex size-8.5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <ul
          className="row-menu-list absolute top-full right-0 z-20 mt-1 flex w-max min-w-44 max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
          role="menu"
        >
          {items.map((item) => (
            <li key={item.label} role="none" className="list-none">
              <button
                type="button"
                role="menuitem"
                data-tone={item.tone}
                className={cx(
                  "ui-btn flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm leading-tight transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  item.tone === "danger"
                    ? "text-danger hover:bg-danger-bg"
                    : "text-ink hover:bg-surface-2",
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="row-menu-icon w-4 text-center opacity-70" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
