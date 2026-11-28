"use client";
import type { ReactNode } from "react";
import { cx } from "./shared.ts";

export type InsightTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export type InsightCardProps = {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  tone?: InsightTone;
  variant?: "card" | "row";
  action?: ReactNode;
  className?: string;
};

export type InsightGridProps = {
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
};

const iconChipToneClass: Record<InsightTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent-ink",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
};

const eyebrowToneClass: Record<InsightTone, string> = {
  neutral: "text-muted",
  accent: "text-accent-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

const gridColsClass: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Item ou cartão editorial limpo seguindo o padrão hairline do sistema de design.
 */
export function InsightCard({
  icon,
  eyebrow,
  title,
  detail,
  tone = "neutral",
  variant = "card",
  action,
  className,
}: InsightCardProps) {
  const containerClass =
    variant === "row"
      ? "flex min-w-0 flex-col justify-between gap-2.5 py-3.5 first:pt-1 last:pb-1"
      : "flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border bg-surface p-4";

  return (
    <article className={cx(containerClass, className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon != null ? (
          <span
            className={cx(
              "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl",
              iconChipToneClass[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          {eyebrow != null ? (
            <div
              className={cx(
                "text-xs font-medium uppercase tracking-wide",
                eyebrowToneClass[tone],
              )}
            >
              {eyebrow}
            </div>
          ) : null}
          <div className="text-sm font-medium leading-snug text-ink">
            {title}
          </div>
          {detail != null ? (
            <div className="text-xs leading-relaxed text-muted">{detail}</div>
          ) : null}
        </div>
      </div>
      {action != null ? (
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      ) : null}
    </article>
  );
}

/**
 * Grade responsiva para organizar cartões de insight.
 */
export function InsightGrid({
  columns = 2,
  className,
  children,
}: InsightGridProps) {
  return (
    <div className={cx("grid gap-3", gridColsClass[columns], className)}>
      {children}
    </div>
  );
}
