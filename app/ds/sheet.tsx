"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./icon-button.tsx";

/**
 * Painel lateral (≥ 768px) ou folha de baixo (< 768px) sobre <dialog> nativo.
 * Fecha com Esc, clique no fundo ou no botão. Só monta o conteúdo aberto.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none items-end justify-center bg-transparent p-0 text-ink backdrop:bg-black/45 backdrop:backdrop-blur-[2px] md:items-stretch md:justify-end open:flex"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="ds-sheet-panel flex max-h-[90dvh] w-full flex-col gap-5 overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 text-ink shadow-xl md:h-full md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-2xl md:border-y-0 md:border-r-0 md:p-6">
          <header className="ds-sheet-head flex items-center justify-between gap-3">
            <h2 id={titleId} className="m-0 text-lg font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <IconButton icon="close" label="Fechar" onClick={onClose} />
          </header>
          <div className="ds-sheet-body grid flex-1 content-start gap-5">{children}</div>
          {footer ? (
            <footer className="ds-sheet-foot flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
