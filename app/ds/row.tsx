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
  /** Cor de DADO do badge (ex.: cor fixa da categoria). Sobrepõe o tom: o
   *  glifo fica nessa cor e o fundo é ela misturada à superfície. */
  catColor?: string;
  /** Tamanho do badge quando há icon. */
  iconSize?: Size;
  /** Badge sólido (fundo = tom). */
  solid?: boolean;
  /** Título (negrito). */
  title?: string;
  /** Subtítulo. */
  sub?: string;
  /** Conteúdo livre dentro do bloco principal (preferir a title/sub). */
  children?: ReactNode;
  /** Valor à direita: nó livre ou { value, tone } (cor por token). */
  trail?: RowTrail;
  /** Borda superior (linhas separadas). */
  bordered?: boolean;
  /** Com href a linha inteira vira um link (o texto do link é o conteúdo). */
  href?: string;
};

function isTonedTrail(t: RowTrail): t is { value: ReactNode; tone?: Tone } {
  return typeof t === "object" && t !== null && "value" in t;
}

/**
 * Linha genérica — ÚNICA implementação da .ds-row. Lead = swatch (cor de dado,
 * inline) OU badge tonal (reusa IconBadge, data-tone nunca inline) OU nada.
 * Para legenda (sem borda) use <RowList bordered={false}>; para um item avulso
 * use <Row/> direto.
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
    // sw é cor de DADO (legenda) -> só o background vai inline.
    lead = <span className="ds-sw size-3 shrink-0 rounded-sm" style={{ background: sw }} />;
  } else if (icon != null) {
    // catColor é DADO -> só a variável --tone vai inline; o fundo tingido sai
    // do CSS (.ds-badge[data-cat]).
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
      <span className="ds-row-trail toned font-medium whitespace-nowrap tabular-nums text-(--tone)" {...toneAttr(trail.tone)}>
        {trail.value}
      </span>
    ) : (
      <span className="ds-row-trail font-medium whitespace-nowrap tabular-nums">{trail}</span>
    );
  } else if (href) {
    trailNode = (
      <span className="ds-row-trail font-medium whitespace-nowrap" aria-hidden="true">
        ›
      </span>
    );
  }
  // list-row só age dentro de um `.list` do daisyUI; fora dele o grid antigo
  // (.ds-row) continua valendo. list-col-grow marca a coluna principal.
  const className = cx("ds-row list-row", href && "text-inherit no-underline", bordered ? "bordered" : "after:hidden");
  const content = (
    <>
      <span className="ds-row-lead flex items-center">{lead}</span>
      <span className="ds-row-main list-col-grow">
        {title ? <b className="block font-normal">{title}</b> : null}
        {sub ? <small className="block text-xs opacity-60">{sub}</small> : null}
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
