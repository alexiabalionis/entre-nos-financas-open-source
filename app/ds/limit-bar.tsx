"use client";
import type { ReactNode } from "react";
import { cx } from "./shared.ts";

export type LimitBarTone = "accent" | "ok" | "warn" | "danger";

export type LimitBarProps = {
  usedLabel?: string;
  usedValue: ReactNode;
  availableLabel?: string;
  availableValue?: ReactNode;
  totalLabel?: string;
  totalValue?: ReactNode;
  ratio: number;
  tone?: LimitBarTone;
  className?: string;
};

const fillToneClass: Record<LimitBarTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

const availableToneClass: Record<LimitBarTone, string> = {
  accent: "text-ink-2",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

/**
 * Barra compacta de utilização de limite (ex.: fatura vs. limite de cartão).
 */
export function LimitBar({
  usedLabel = "Usado",
  usedValue,
  availableLabel = "Disponível",
  availableValue,
  totalLabel = "Limite",
  totalValue,
  ratio,
  tone = "accent",
  className,
}: LimitBarProps) {
  const clampedRatio = Number.isFinite(ratio)
    ? Math.min(100, Math.max(0, ratio))
    : 0;

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xs text-muted">{usedLabel}</span>
          <span className="font-numeric text-sm font-semibold tabular-nums text-ink">
            {usedValue}
          </span>
        </div>
        {totalValue != null ? (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-xs text-muted">{totalLabel}</span>
            <span className="font-numeric text-xs font-medium tabular-nums text-muted">
              {totalValue}
            </span>
          </div>
        ) : null}
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(clampedRatio)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-300",
            fillToneClass[tone],
          )}
          style={{ width: `${clampedRatio}%` }}
        />
      </div>

      {availableValue != null ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">{availableLabel}</span>
          <span
            className={cx(
              "font-numeric font-medium tabular-nums",
              availableToneClass[tone],
            )}
          >
            {availableValue}
          </span>
        </div>
      ) : null}
    </div>
  );
}
