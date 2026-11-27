"use client";
import {
  useEffect,
  useState,
  type ReactNode,
  type DetailsHTMLAttributes,
} from "react";
import { Icon } from "./ds/icon";
import { cx } from "./ds/shared";

type Variant = "inline" | "card";

type CollapsibleProps = Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  "onToggle" | "children" | "open"
> & {
  summary: ReactNode;
  description?: ReactNode;
  variant?: Variant;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  revealOnHash?: string;
  activeBorder?: boolean;
  arrow?: boolean;
  children: ReactNode;
};

/**
 * Bloco expansível sobre `<details>/<summary>` nativo em Tailwind v4 puro.
 */
export function Collapsible({
  summary,
  description,
  variant = "inline",
  open,
  defaultOpen = false,
  onOpenChange,
  revealOnHash,
  activeBorder = false,
  arrow = true,
  children,
  className,
  ...rest
}: CollapsibleProps) {
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlled ? open : internalOpen;

  useEffect(() => {
    if (controlled || !revealOnHash) return;
    const reveal = () => {
      if (location.hash.startsWith(revealOnHash)) setInternalOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [controlled, revealOnHash]);

  return (
    <details
      {...rest}
      className={cx(
        "ui-collapsible group",
        `ui-collapsible--${variant}`,
        variant === "card"
          ? "rounded-2xl border border-border bg-surface"
          : "rounded-xl border border-border bg-surface",
        activeBorder && "open:border-accent",
        className,
      )}
      open={isOpen}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (!controlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          {variant === "card" ? (
            <span className="ui-collapsible-heading min-w-0">
              <strong className="block text-sm font-semibold text-ink">{summary}</strong>
              {description && (
                <small className="block text-xs font-normal text-muted">
                  {description}
                </small>
              )}
            </span>
          ) : (
            summary
          )}
        </span>
        {arrow ? (
          <Icon
            name="down"
            size={16}
            className="shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
          />
        ) : null}
      </summary>
      <div
        className={cx(
          variant === "card"
            ? "ui-collapsible-body border-t border-border px-4 pb-4 pt-3"
            : "px-4 pb-3.5 pt-0.5",
        )}
      >
        {children}
      </div>
    </details>
  );
}
