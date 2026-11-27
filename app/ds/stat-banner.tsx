"use client";
import { useId, useState } from "react";
import type { ReactNode, Toned } from "./shared";
import { cx } from "./shared";
import { useExpandHeight } from "./use-expand-height.ts";

type ProgressRailProps = Toned & {
  /** Percentual 0..100. */
  pct: number;
  inverted?: boolean;
};

const railFillTone: Record<NonNullable<Toned["tone"]>, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  accent: "bg-accent",
  neutral: "bg-muted",
};

/**
 * Trilha de progresso pura em Tailwind (sem daisyUI progress).
 */
function ProgressRail({ pct, tone, inverted }: ProgressRailProps) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx(
        "ds-rail mt-4 h-2 w-full overflow-hidden rounded-full",
        inverted ? "bg-white/15" : "bg-surface-2",
      )}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-300",
          inverted ? "bg-white" : tone ? railFillTone[tone] : "bg-accent",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

type StatBannerProps = {
  /** Rótulo pequeno acima do valor. */
  eyebrow?: ReactNode;
  /** Valor em destaque. */
  value: ReactNode;
  /** Usa a variante "title" (valor menor, multilinha). */
  title?: boolean;
  /** Texto de apoio abaixo do valor. */
  caption?: ReactNode;
  /** Percentual da trilha (0..100). */
  rail?: number | null;
  /** Tom da trilha. */
  railTone?: Toned["tone"];
  /** Slot à direita do eyebrow (chip, botão, etc.). */
  trailing?: ReactNode;
  /** Variante de marca (Branded Hero). */
  inverted?: boolean;
  /** Marca o valor como negativo (cor). */
  neg?: boolean;
  /** Slot livre no rodapé do banner — sempre visível. */
  children?: ReactNode;
  /** Quando presente, o cartão inteiro vira um disclosure para detalhar a conta. */
  expand?: { label: ReactNode; content: ReactNode };
  /** Tocar no valor revela `content` logo abaixo dele (ex.: saldo por conta). */
  valueDetail?: { label: string; content: ReactNode };
  className?: string;
};

/**
 * Banner de métrica em destaque.
 * `inverted` = Branded Hero do topo da tela Mês (gradiente profundo da marca + texto branco).
 */
export function StatBanner({
  eyebrow,
  value,
  title,
  caption,
  rail,
  railTone,
  trailing,
  inverted,
  neg,
  children,
  expand,
  valueDetail,
  className,
}: StatBannerProps) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();
  const [openCount, setOpenCount] = useState(0);
  const height = useExpandHeight(open, openCount);
  const contentId = useId();

  const shell = inverted
    ? "inverted is-hero-inverted rounded-2xl border p-5 sm:p-6 shadow-sm"
    : "rounded-xl border border-border/80 bg-surface-2/60 p-4";

  const top = (
    <>
      <div className="ds-stat-top flex items-center justify-between gap-3">
        <span
          className={cx(
            "ds-eyebrow text-xs font-medium tracking-wide",
            inverted ? "uppercase text-white/75" : "text-muted",
          )}
        >
          {eyebrow ?? ""}
        </span>
        {trailing}
      </div>
      <div
        className={cx(
          "ds-value font-numeric tabular-nums mt-2 tracking-tight",
          inverted
            ? "text-[2.125rem] sm:text-[2.625rem] font-semibold leading-[1.08] text-white"
            : "text-2xl font-semibold leading-tight text-ink",
          title && "!text-xl sm:!text-2xl leading-snug whitespace-normal",
          neg && (inverted ? "is-neg !text-red-300" : "is-neg text-danger"),
        )}
      >
        {valueDetail ? (
          <button
            type="button"
            className="ds-stat-value-btn ui-reset-btn inline-flex cursor-pointer items-baseline gap-2 text-left [color:inherit] [font:inherit]"
            aria-expanded={detailOpen}
            aria-controls={detailId}
            aria-label={valueDetail.label}
            onClick={() => setDetailOpen(!detailOpen)}
          >
            {value}
            <span
              className={cx(
                "ds-stat-expand-arrow text-base",
                inverted ? "text-white/75" : "text-muted",
              )}
              aria-hidden="true"
            >
              ↓
            </span>
          </button>
        ) : (
          value
        )}
      </div>
      {valueDetail ? (
        <div
          id={detailId}
          hidden={!detailOpen}
          className={cx(
            "mt-3 rounded-xl px-3 py-2",
            inverted ? "bg-white/10" : "bg-surface border border-border",
          )}
          data-stat-detail
        >
          {valueDetail.content}
        </div>
      ) : null}
      {caption != null ? (
        <div
          className={cx(
            "ds-caption mt-2 text-sm leading-relaxed",
            inverted ? "!text-white/80" : "text-muted",
          )}
        >
          {caption}
        </div>
      ) : null}
      {rail != null ? <ProgressRail pct={rail} tone={railTone} inverted={inverted} /> : null}
      {children ? <div className="ds-stat-slot mt-3.5">{children}</div> : null}
    </>
  );

  if (!expand) {
    return <section className={cx("ds-stat", shell, className)}>{top}</section>;
  }

  function handleToggleClick() {
    const nowOpen = !open;
    setOpen(nowOpen);
    if (nowOpen) setOpenCount((c) => c + 1);
  }

  const expandTriggerHint = (
    <span
      className={cx(
        "ds-stat-expand-hint mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        inverted
          ? "bg-white/12 text-white/90 hover:bg-white/18"
          : "bg-surface text-muted border border-border",
      )}
    >
      {expand.label}
      <span className="ds-stat-expand-arrow" aria-hidden="true">
        ↓
      </span>
    </span>
  );

  return (
    <section className={cx("ds-stat", shell, open && "is-open", className)}>
      <div
        className="cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a, [data-stat-detail]")) return;
          handleToggleClick();
        }}
      >
        {top}
      </div>
      <button
        type="button"
        className="ds-stat-summary ui-reset-btn mt-4 cursor-pointer text-left [color:inherit] [font:inherit]"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={handleToggleClick}
      >
        {expandTriggerHint}
      </button>
      <div
        id={contentId}
        className="ds-stat-expand-wrap"
        style={height.style}
        onTransitionEnd={height.onTransitionEnd}
      >
        <div
          className={cx(
            "ds-stat-expand-body mt-5 border-t pt-4",
            inverted ? "border-white/15" : "border-border",
          )}
          key={openCount}
          ref={height.bodyRef}
        >
          {expand.content}
        </div>
      </div>
    </section>
  );
}
