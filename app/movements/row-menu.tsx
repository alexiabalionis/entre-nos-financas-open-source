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
 * Menu "⋯" no canto de uma linha de lista. Só guarda se está aberto: cada item
 * chama `onSelect` e fecha. Fecha também ao tocar fora ou com Escape.
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
    <div className="row-menu absolute top-5 right-1.5 z-10" ref={root}>
      <button
        type="button"
        className="row-menu-trigger btn btn-ghost btn-sm btn-circle"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        // Absoluto dentro de um gatilho de 32px: sem `w-max` a largura
        // "encolhe para caber" nos 32px e só o min-width segurava, quebrando
        // "Tornar conta fixa" em duas linhas. Largura = conteúdo, com teto na tela.
        <ul
          className="row-menu-list menu absolute top-full right-0 z-10 mt-1 w-max min-w-40 max-w-[min(18rem,calc(100vw-2rem))] gap-0.5 rounded-box border border-base-300 bg-base-100 p-1 shadow-md"
          role="menu"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                data-tone={item.tone}
                className={cx(
                  "min-h-9 gap-2.5 px-3 py-2 text-sm leading-tight",
                  item.tone === "danger" && "text-error",
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="row-menu-icon w-4 text-center opacity-60" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
