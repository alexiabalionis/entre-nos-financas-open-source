"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./icon-button.tsx";

/**
 * Painel lateral (≥ 768px) ou folha de baixo (< 768px) sobre <dialog> nativo.
 * Visual do daisyUI: `modal` no dialog (cobre a tela e faz o escurecimento) e
 * `modal-box` no painel; `modal-bottom` no mobile e `modal-end` a partir de md.
 * Fecha com Esc, clique no fundo ou no botão. Só monta o conteúdo aberto.
 * Não substitui o FamilyDialog (formulários centrados).
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
      className="modal modal-bottom md:modal-end"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        // modal-bottom no celular, modal-end no desktop (só a largura é nossa).
        <div className="ds-sheet-panel modal-box flex flex-col gap-5 md:w-[440px]">
          <header className="ds-sheet-head flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <IconButton icon="close" label="Fechar" onClick={onClose} />
          </header>
          <div className="ds-sheet-body grid content-start gap-5">{children}</div>
          {footer ? <footer className="ds-sheet-foot modal-action flex-wrap">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
