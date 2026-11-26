"use client";
import { Icon, type IconName } from "./icon";
import { cx, type ReactNode } from "./shared";

export type StatRow = { label: string; value: string };

/**
 * Uma coluna de `stats` do daisyUI: título (com ícone opcional), número em
 * destaque e, opcionalmente, legenda e composição em lista de definição.
 * Vai dentro de <Stats>. Usado no topo de Movimentos e do Panorama.
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
  /** Cor do círculo do ícone. */
  tone?: "ok" | "danger";
  caption?: ReactNode;
  /** Valor negativo (cor de erro). */
  neg?: boolean;
  rows?: StatRow[];
}) {
  return (
    <div className="stat content-start gap-y-1">
      <div className="stat-title flex items-center gap-2 text-sm whitespace-normal">
        {icon ? (
          <span
            className={cx(
              "grid size-6 shrink-0 place-items-center rounded-full",
              tone === "ok" && "bg-success/15 text-success",
              tone === "danger" && "bg-error/15 text-error",
              !tone && "bg-base-200",
            )}
          >
            <Icon name={icon} size={14} />
          </span>
        ) : null}
        {title}
      </div>
      <div
        className={cx(
          "stat-value text-2xl tabular-nums sm:text-3xl [font-family:var(--family-font-numeric)]",
          neg && "text-error",
        )}
      >
        {value}
      </div>
      {caption ? <div className="stat-desc whitespace-normal">{caption}</div> : null}
      {rows && rows.length > 0 ? (
        <dl className="mt-3 grid gap-1.5 border-t border-base-300 pt-3 text-xs">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <dt className="min-w-0 opacity-60">{r.label}</dt>
              <dd className="shrink-0 font-medium tabular-nums [font-family:var(--family-font-numeric)]">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Cartão `stats` com borda; empilha no celular. `grid4` = 2×2 no celular, 4 no desktop. */
export function Stats({
  label,
  grid4,
  children,
}: {
  label?: string;
  grid4?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        "stats w-full border border-base-300 bg-base-100 shadow-sm",
        grid4
          ? // A coluna do app é estreita (~720px): 4 lado a lado estoura valores em R$.
            "grid grid-flow-row grid-cols-2 [&>.stat:nth-child(2n)]:border-e-0 [&>.stat:nth-child(n+3)]:border-t [&>.stat:nth-child(n+3)]:[border-top-style:dashed] [&>.stat:nth-child(n+3)]:border-base-300"
          : "stats-vertical sm:stats-horizontal",
      )}
    >
      {children}
    </section>
  );
}
