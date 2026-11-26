"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, badgeTone, toneAttr, type Toned } from "./shared";

type StatusChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  Toned & {
    /** Palavra do status. */
    label: ReactNode;
    /** Marca à esquerda: um ícone/emoji. Sem ícone, mostra o ponto (ds-dot). */
    icon?: ReactNode;
    /** Variante de contorno sem fundo. */
    ghost?: boolean;
  };

/**
 * Etiqueta de status: marca (ponto ou ícone) + palavra, colorida pelo tom via
 * family.css. O tom default do CSS é neutral, então só passamos data-tone
 * quando há tom explícito.
 */
export function StatusChip({
  label,
  icon,
  tone,
  ghost,
  className,
  ...rest
}: StatusChipProps) {
  const classes = cx(
    "ds-chip badge badge-sm rounded-full",
    ghost ? "ghost badge-outline" : "badge-soft",
    tone && badgeTone[tone],
    className,
  );
  return (
    <span {...rest} className={classes} {...toneAttr(tone)}>
      {icon != null ? icon : <span className="ds-dot status status-xs bg-current" />}
      {label}
    </span>
  );
}
