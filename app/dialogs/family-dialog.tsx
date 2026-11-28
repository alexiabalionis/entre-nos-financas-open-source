"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "../ds/icon-button.tsx";

/**
 * Janela de diálogo do app (<dialog> nativo em Tailwind v4 puro): título,
 * botão fechar, bloqueio de fechamento enquanto grava e erro da ação.
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
      className="ui-dialog-backdrop fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none items-center justify-center bg-transparent p-4 text-ink backdrop:bg-black/45 backdrop:backdrop-blur-[2px] open:flex"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onClose();
      }}
      aria-labelledby={titleId}
    >
      {open && (
        <div className="family-dialog w-full max-w-[30rem] max-h-[calc(var(--chat-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-24px)] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-ink shadow-xl">
          <div className="family-section mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="m-0 text-lg leading-snug font-semibold text-ink"
              >
                {title}
              </h2>
              {description && (
                <p className="m-0 mt-1 text-sm leading-snug text-muted [overflow-wrap:anywhere] line-clamp-3">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon="close"
              size="sm"
              label="Fechar"
              disabled={busy}
              onClick={onClose}
            />
          </div>
          {children}
          {error && (
            <p
              className="m-0 mt-3 rounded-xl border border-danger/25 bg-danger-bg px-3.5 py-2.5 text-sm font-medium text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
