"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Collapse } from "./ds/collapse.tsx";
import { Icon } from "./ds/icon.tsx";
import { FlatPanelsProvider } from "./ds/panel.tsx";
import { cx } from "./ds/shared.ts";

/** Duração do fechamento do Collapse (family.css .ds-collapse). */
const SETTLE_MS = 680;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Cartão do Nosso espaço: o cabeçalho inteiro é o botão, o corpo abre e fecha
 * com o Collapse do DS (fechado fica inerte, fora do foco e do leitor).
 * Os Panels lá dentro viram seções planas, sem cartão dentro de cartão.
 * Ao abrir, se o cabeçalho saiu da tela (outro cartão acima fechou), ele volta
 * para o topo da vista.
 */
export function ProfileCard({
  title,
  description,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.4)
        el.scrollIntoView({
          block: "start",
          behavior: reducedMotion() ? "auto" : "smooth",
        });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  return (
    <section
      ref={ref}
      className={cx(
        "profile-card min-w-0 scroll-mt-4 rounded-2xl border bg-surface shadow-xs transition-colors duration-200",
        expanded ? "border-accent" : "border-border",
      )}
      data-expanded={expanded}
    >
      <h2 className="m-0">
        <button
          type="button"
          id={id + "-title"}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={onToggle}
          className={cx(
            "ui-reset-btn flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left font-normal text-ink transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            expanded && "rounded-b-none",
          )}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <strong className="text-sm font-semibold">{title}</strong>
            <small className="text-xs text-muted">
              {description}
            </small>
          </span>
          <span
            className="ds-collapse-arrow shrink-0 text-muted"
            aria-hidden="true"
          >
            <Icon name="down" size={20} />
          </span>
        </button>
      </h2>
      <Collapse id={id} open={expanded}>
        <div
          role="region"
          aria-labelledby={id + "-title"}
          className="flex min-w-0 flex-col gap-4 border-t border-border p-4"
        >
          <FlatPanelsProvider>{children}</FlatPanelsProvider>
        </div>
      </Collapse>
    </section>
  );
}
