"use client";
import { Icon, type IconName } from "./icon";
import { cx, type ReactNode } from "./shared";

export type StatRow = { label: string; value: string };

/**
 * Coluna de métrica dentro de <Stats>. Pure Tailwind v4 sobre tokens --ui-*.
 */
export function Stat({
  title,
  value,
  icon,
  tone,
  caption,
  neg,
  rows,
}: {
  title: string;
  value: ReactNode;
  icon?: IconName;
  tone?: "ok" | "danger";
  caption?: ReactNode;
  neg?: boolean;
  rows?: StatRow[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        {icon ? (
          <span
            className={cx(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
              tone === "ok" && "bg-ok-bg text-ok",
              tone === "danger" && "bg-danger-bg text-danger",
              !tone && "bg-surface-2 text-muted",
            )}
          >
            <Icon name={icon} size={14} />
          </span>
        ) : null}
        <span>{title}</span>
      </div>
      <div
        className={cx(
          "font-numeric text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.75rem]",
          neg ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </div>
      {caption ? (
        <div className="text-xs leading-relaxed text-muted">{caption}</div>
      ) : null}
      {rows && rows.length > 0 ? (
        <dl className="mt-3 grid gap-1.5 border-t border-border pt-3 text-xs">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <dt className="min-w-0 text-muted">{r.label}</dt>
              <dd className="m-0 shrink-0 font-numeric font-medium tabular-nums text-ink">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Cartão de métricas lado a lado no desktop e empilhado no celular. */
export function Stats({
  label,
  grid4,
  columns,
  children,
}: {
  label?: string;
  grid4?: boolean;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const cols = columns ?? (grid4 ? 4 : 2);
  return (
    <section
      aria-label={label}
      className={cx(
        "w-full overflow-hidden rounded-2xl border border-border bg-surface",
        cols === 4
          ? "grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0"
          : cols === 3
            ? "grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
            : "grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0",
      )}
    >
      {children}
    </section>
  );
}
