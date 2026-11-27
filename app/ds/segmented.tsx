"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx } from "./shared";

type Pill = { left: number; top: number; width: number; height: number };

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: string;
  badge?: number;
};

/**
 * Seletor segmentado (radiogroup) com pílula deslizante em Tailwind puro.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "md",
  fill = false,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  const count = options.length;

  const [pill, setPill] = useState<Pill | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelectorAll<HTMLButtonElement>("button")[idx];
      setPill((prev) => {
        if (!tab) return null;
        const next = {
          left: tab.offsetLeft,
          top: tab.offsetTop,
          width: tab.offsetWidth,
          height: tab.offsetHeight,
        };
        return prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
          ? prev
          : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [idx, count, options]);

  const go = (n: number) => {
    onChange(options[n].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[n]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const from = idx < 0 ? 0 : idx;
    let n: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (from + 1) % count;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (from - 1 + count) % count;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = count - 1;
    if (n === null) return;
    e.preventDefault();
    go(n);
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      data-pill={pill ? "" : undefined}
      className={cx(
        "ds-seg relative isolate inline-flex flex-nowrap items-center gap-0.5 rounded-xl border border-border/80 bg-surface-2 p-1",
        fill ? "w-full min-w-max [&>button]:flex-1" : "w-fit max-w-full overflow-x-auto",
      )}
      onKeyDown={onKeyDown}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="ds-seg-pill"
          style={{
            width: pill.width,
            height: pill.height,
            transform: `translate(${pill.left}px, ${pill.top}px)`,
          }}
        />
      )}
      {options.map((o, i) => {
        const active = i === idx;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={cx(
              "ui-seg-tab relative z-0 inline-flex shrink-0 items-center justify-center rounded-lg whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              size === "sm" ? "h-7 px-2.5 text-[0.8125rem]" : "h-8.5 px-3.5 text-sm",
              active
                ? "tab-active font-semibold text-ink"
                : "font-medium text-muted hover:text-ink",
              !pill && active && "bg-surface shadow-xs border border-border",
            )}
            role="radio"
            aria-checked={active}
            tabIndex={active || (idx < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            <span>{o.label}</span>
            {o.badge != null && o.badge > 0 ? (
              <span
                className={cx(
                  "ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.5 font-numeric text-[0.6875rem] leading-none font-semibold tabular-nums",
                  active
                    ? "bg-accent-soft text-accent-ink"
                    : "border border-border bg-surface text-muted",
                )}
              >
                {o.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
