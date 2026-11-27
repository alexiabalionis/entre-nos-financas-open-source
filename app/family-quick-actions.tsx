"use client";
import { useEffect, useId, useRef, useState } from "react";

export function QuickActions({
  planning,
  reader,
  onIncome,
  onExpense,
  tourTarget = true,
}: {
  planning: boolean;
  reader: boolean;
  onIncome: () => void;
  onExpense: () => void;
  onEdit?: () => void;
  tourTarget?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const id = useId();
  function close() {
    setExpanded(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!expanded) return;
    first.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [expanded]);

  const actions = [
    {
      label: planning ? "Planejar Entrada" : "Adicionar Entrada",
      run: onIncome,
      icon: "income",
      disabled: reader,
    },
    {
      label: planning ? "Planejar Gastos" : "Registrar Gasto",
      run: onExpense,
      icon: "expense",
      disabled: reader,
    },
  ];

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="ui-reset-btn lg:hidden fixed inset-0 z-31 bg-black/25 backdrop-blur-[1px]"
          aria-label="Fechar ações rápidas"
          onClick={close}
          tabIndex={-1}
        />
      )}
      <div
        className="lg:hidden fixed left-5 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-32 flex max-w-[calc(100vw-2.5rem)] flex-col items-start gap-3 pointer-events-none"
        data-open={expanded}
      >
        <div
          id={id}
          className={`flex flex-col gap-2.5 transition-all duration-200 ${
            expanded
              ? "visible translate-y-0 opacity-100 pointer-events-auto"
              : "invisible translate-y-3 opacity-0 pointer-events-none"
          }`}
          role="group"
          aria-label="Ações do mês"
          aria-hidden={!expanded}
          inert={!expanded}
        >
          {actions.map((action, index) => (
            <button
              key={action.icon}
              type="button"
              ref={index === 0 ? first : undefined}
              disabled={action.disabled}
              className="ui-reset-btn flex items-center gap-3 text-left cursor-pointer disabled:opacity-50"
              onClick={() => {
                setExpanded(false);
                action.run();
              }}
            >
              <span
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-ink shadow-md"
                aria-hidden="true"
              >
                <svg
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path
                    d={
                      action.icon === "income"
                        ? "M12 4v16m-6-6 6 6 6-6"
                        : "M12 20V4m-6 6 6-6 6 6"
                    }
                  />
                </svg>
              </span>
              <span className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-sm">
                {action.label}
              </span>
            </button>
          ))}
        </div>

        <button
          ref={trigger}
          data-tour={tourTarget ? "quick-actions" : undefined}
          className="ui-reset-btn pointer-events-auto inline-flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg transition-all duration-150 hover:bg-accent-hover active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          type="button"
          aria-label={expanded ? "Fechar ações" : "Abrir ações"}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => (expanded ? close() : setExpanded(true))}
        >
          <svg
            aria-hidden="true"
            className={`size-6 transition-transform duration-200 ${
              expanded ? "rotate-45" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </>
  );
}
