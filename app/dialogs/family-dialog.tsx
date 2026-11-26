"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../ds/icon.tsx";

/**
 * Janela de diálogo do app (<dialog> nativo com `modal` do daisyUI; a janela
 * em si é o `modal-box`, que leva o family-dialog): título, botão fechar, bloqueio
 * de fechamento enquanto grava e erro da ação dentro da janela. Cada formulário
 * (item, conferência, mês, entrada, movimento) usa esta mesma janela.
 */
export function FamilyDialog({
  open,
  title,
  description,
  busy,
  error,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  /** Linha de contexto sob o título (ex.: a descrição da transação). */
  description?: ReactNode;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="modal modal-middle"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
      aria-labelledby={titleId}
    >
      {open && (
        // family-dialog vai no modal-box: o dialog agora cobre a tela inteira
        // (é o fundo), então borda/raio/rolagem do CSS antigo ficam na janela.
        // Padding e altura máxima seguem os valores antigos (sticky do título).
        // 480px: cabe um formulário de 1 coluna sem sobrar meia tela vazia
        // (o modal-box padrão vai a 512px). Some no celular (largura toda).
        <div className="family-dialog modal-box w-full max-w-[30rem] max-h-[calc(var(--chat-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-24px)]">
          <div className="family-section mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="m-0 text-lg leading-snug font-semibold">
                {title}
              </h2>
              {description && (
                <p className="m-0 mt-1 text-sm leading-snug text-base-content/70 [overflow-wrap:anywhere] line-clamp-3">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-circle btn-sm shrink-0"
              aria-label="Fechar"
              disabled={busy}
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {children}
          {error && (
            <p className="family-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
