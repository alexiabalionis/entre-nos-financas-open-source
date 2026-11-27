"use client";
import { useId, useState, type ReactNode } from "react";
import { Collapse } from "./collapse.tsx";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

export type AccordionGroupProgressTone = "accent" | "ok" | "warn" | "danger";

export type AccordionGroupProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  trailing?: ReactNode;
  progress?: number;
  progressTone?: AccordionGroupProgressTone;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "card" | "row";
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
};

const progressFillClass: Record<AccordionGroupProgressTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/**
 * Grupo expansível acessível para seções em linha (`row`) ou em cartão (`card`).
 * Suporta modo controlado (`open` + `onOpenChange`) e não controlado (`defaultOpen`).
 */
export function AccordionGroup({
  title,
  subtitle,
  badge,
  trailing,
  progress,
  progressTone = "accent",
  defaultOpen = false,
  open,
  onOpenChange,
  variant = "row",
  className,
  headerClassName,
  contentClassName,
  children,
}: AccordionGroupProps) {
  const panelId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const hasProgress = typeof progress === "number";
  const clampedProgress = hasProgress
    ? Number.isFinite(progress)
      ? Math.min(100, Math.max(0, progress))
      : 0
    : 0;

  function handleToggle() {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div
      className={cx(
        "min-w-0",
        variant === "card" && "rounded-2xl border border-border bg-surface",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={handleToggle}
        className={cx(
          "ui-reset-btn group flex w-full cursor-pointer flex-col gap-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          variant === "card"
            ? cx(
                "px-4 py-3.5 hover:bg-surface-2/50 sm:px-5",
                isOpen ? "rounded-t-2xl" : "rounded-2xl",
              )
            : "rounded-lg py-3.5 hover:bg-surface-2/40",
          headerClassName,
        )}
      >
        <span className="flex w-full min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 text-sm font-semibold leading-snug text-ink">
                {title}
              </span>
              {badge != null ? (
                <span className="inline-flex shrink-0 items-center">{badge}</span>
              ) : null}
            </span>
            {subtitle != null ? (
              <span className="text-xs leading-snug text-muted">{subtitle}</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {trailing != null ? (
              <span className="inline-flex items-center font-numeric text-sm font-medium tabular-nums text-ink">
                {trailing}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center text-muted transition-transform duration-200 group-hover:text-ink",
                isOpen && "rotate-180",
              )}
            >
              <Icon name="down" size={16} />
            </span>
          </span>
        </span>
        {hasProgress ? (
          <span
            aria-hidden="true"
            className="block h-1 w-full overflow-hidden rounded-full bg-surface-2"
          >
            <span
              className={cx(
                "block h-full rounded-full transition-[width] duration-300",
                progressFillClass[progressTone],
              )}
              style={{ width: `${clampedProgress}%` }}
            />
          </span>
        ) : null}
      </button>
      <Collapse id={panelId} open={isOpen}>
        <div
          className={cx(
            variant === "card"
              ? "border-t border-border px-4 py-3.5 sm:px-5"
              : "pt-1 pb-4",
            contentClassName,
          )}
        >
          {children}
        </div>
      </Collapse>
    </div>
  );
}
