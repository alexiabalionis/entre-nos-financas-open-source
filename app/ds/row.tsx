"use client";
import type { CSSProperties } from "react";
import { IconBadge } from "./icon-badge";
import type { ReactNode, Size, Tone, Toned } from "./shared";
import { cx, toneAttr } from "./shared";

/** Trail por tom (valor + cor via token) ou nó livre. */
type RowTrail = ReactNode | { value: ReactNode; tone?: Tone };

export type RowProps = Toned & {
  /** Cor do swatch à esquerda. É DADO (cor de legenda) -> inline via style. */
  sw?: string;
  /** Ícone no badge tonal à esquerda (alternativa ao sw). */
  icon?: ReactNode;
  /** Cor de DADO do badge (ex.: cor fixa da categoria). */
  catColor?: string;
  /** Tamanho do badge quando há icon. */
  iconSize?: Size;
  /** Badge sólido (fundo = tom). */
  solid?: boolean;
  /** Título. */
  title?: string;
  /** Subtítulo. */
  sub?: string;
  /** Conteúdo livre dentro do bloco principal. */
  children?: ReactNode;
  /** Valor à direita: nó livre ou { value, tone }. */
  trail?: RowTrail;
  /** Borda divisória entre linhas. */
  bordered?: boolean;
  /** Com href a linha inteira vira um link. */
  href?: string;
};

function isTonedTrail(t: RowTrail): t is { value: ReactNode; tone?: Tone } {
  return typeof t === "object" && t !== null && "value" in t;
}

const trailToneClass: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent-ink",
  neutral: "text-muted",
};

/**
 * Linha genérica em Tailwind v4 puro (sem daisyUI list-row).
 */
export function Row({
  sw,
  icon,
  catColor,
  iconSize,
  solid,
  tone,
  title,
  sub,
  children,
  trail,
  bordered,
  href,
}: RowProps) {
  let lead: ReactNode = null;
  if (sw != null) {
    lead = <span className="ds-sw inline-block size-3 shrink-0 rounded-sm" style={{ background: sw }} />;
  } else if (icon != null) {
    lead = (
      <IconBadge
        icon={icon}
        tone={tone}
        size={iconSize}
        solid={solid}
        {...(catColor
          ? {
              "data-cat": "",
              style: { "--tone": catColor, "--badge-color": catColor } as CSSProperties,
            }
          : {})}
      />
    );
  }
  let trailNode: ReactNode = null;
  if (trail != null) {
    trailNode = isTonedTrail(trail) ? (
      <span
        className={cx(
          "ds-row-trail font-numeric text-sm font-semibold whitespace-nowrap tabular-nums",
          trail.tone ? trailToneClass[trail.tone] : "text-ink",
        )}
        {...toneAttr(trail.tone)}
      >
        {trail.value}
      </span>
    ) : (
      <span className="ds-row-trail font-numeric text-sm font-medium whitespace-nowrap tabular-nums text-ink">
        {trail}
      </span>
    );
  } else if (href) {
    trailNode = (
      <span className="ds-row-trail text-muted whitespace-nowrap" aria-hidden="true">
        ›
      </span>
    );
  }

  const className = cx(
    "ds-row flex items-center gap-3 py-2.5 min-w-0",
    bordered && "border-t border-border first:border-t-0",
    href &&
      "rounded-lg px-2 -mx-2 text-inherit no-underline transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  );
  const content = (
    <>
      {lead ? <span className="ds-row-lead flex shrink-0 items-center">{lead}</span> : null}
      <span className="ds-row-main min-w-0 flex-1">
        {title ? <b className="block truncate text-sm font-medium text-ink">{title}</b> : null}
        {sub ? <small className="block text-xs text-muted leading-snug">{sub}</small> : null}
        {children}
      </span>
      {trailNode}
    </>
  );
  return href ? (
    <a className={className} href={href}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
