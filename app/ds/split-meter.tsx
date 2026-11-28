"use client";
import type { ReactNode } from "react";
import { cx } from "./shared.ts";

export type SplitMeterSegment = {
  key?: string;
  label: ReactNode;
  percent: number;
  color: string;
  value?: ReactNode;
  hint?: ReactNode;
};

export type SplitMeterProps = {
  eyebrow?: ReactNode;
  title?: ReactNode;
  headline?: ReactNode;
  segments: SplitMeterSegment[];
  ariaLabel?: string;
  footer?: ReactNode;
  className?: string;
};

/**
 * Cartão de distribuição proporcional com barra segmentada e legenda responsiva.
 * Normaliza larguras quando a soma passa de 100% e renderiza trilha neutra
 * quando não há valores positivos.
 */
export function SplitMeter({
  eyebrow,
  title,
  headline,
  segments,
  ariaLabel,
  footer,
  className,
}: SplitMeterProps) {
  const positiveSegments = segments
    .map((segment, index) => ({
      ...segment,
      index,
      safePercent:
        Number.isFinite(segment.percent) && segment.percent > 0
          ? segment.percent
          : 0,
    }))
    .filter((segment) => segment.safePercent > 0);

  const totalPositive = positiveSegments.reduce(
    (sum, segment) => sum + segment.safePercent,
    0,
  );
  const scale = totalPositive > 100 ? 100 / totalPositive : 1;

  const hasHeader = eyebrow != null || title != null || headline != null;
  const accessibleLabel =
    ariaLabel ?? (typeof title === "string" ? title : "Distribuição proporcional");

  return (
    <section
      className={cx(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5",
        className,
      )}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 space-y-0.5">
            {eyebrow != null ? (
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                {eyebrow}
              </div>
            ) : null}
            {title != null ? (
              <div className="text-[0.9375rem] font-semibold leading-snug tracking-tight text-ink">
                {title}
              </div>
            ) : null}
          </div>
          {headline != null ? (
            <div className="font-numeric text-lg font-semibold tracking-tight tabular-nums text-ink">
              {headline}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        role="img"
        aria-label={accessibleLabel}
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
      >
        {positiveSegments.map((segment) => {
          const width = Math.max(0, segment.safePercent * scale);
          return (
            <span
              key={segment.key ?? segment.index}
              className="h-full min-w-[2px] first:rounded-l-full last:rounded-r-full"
              style={{ width: `${width}%`, backgroundColor: segment.color }}
            />
          );
        })}
      </div>

      {segments.length > 0 ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
          {segments.map((segment, index) => {
            const displayPercent = Number.isFinite(segment.percent)
              ? Math.max(0, Math.round(segment.percent))
              : 0;
            return (
              <div
                key={segment.key ?? index}
                className="flex min-w-0 items-start gap-2.5 rounded-xl bg-surface-2/60 px-3 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-ink">
                      {segment.label}
                    </span>
                    <span className="shrink-0 font-numeric text-xs font-semibold tabular-nums text-ink">
                      {displayPercent}%
                    </span>
                  </div>
                  {segment.value != null ? (
                    <div className="mt-0.5 font-numeric text-sm font-semibold tabular-nums text-ink">
                      {segment.value}
                    </div>
                  ) : null}
                  {segment.hint != null ? (
                    <div className="mt-0.5 text-xs leading-snug text-muted">
                      {segment.hint}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {footer != null ? (
        <div className="border-t border-border pt-3 text-xs leading-relaxed text-muted">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
