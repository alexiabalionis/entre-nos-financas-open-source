"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, toneAttr, type Tone, type Toned } from "./shared";

type StatusChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  Toned & {
    /** Palavra do status. */
    label: ReactNode;
    /** Marca à esquerda: um ícone/emoji. Sem ícone, mostra o ponto (ds-dot). */
    icon?: ReactNode;
    /** Variante de contorno sem fundo. */
    ghost?: boolean;
  };

const softTone: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok border-ok/20",
  warn: "bg-warn-bg text-warn border-warn/25",
  danger: "bg-danger-bg text-danger border-danger/25",
  accent: "bg-accent-soft text-accent-ink border-accent/20",
  neutral: "bg-surface-2 text-muted border-border",
};

const ghostTone: Record<Tone, string> = {
  ok: "bg-transparent text-ok border-ok/40",
  warn: "bg-transparent text-warn border-warn/40",
  danger: "bg-transparent text-danger border-danger/40",
  accent: "bg-transparent text-accent-ink border-accent/35",
  neutral: "bg-transparent text-muted border-border",
};

/**
 * Etiqueta de status com piso tipográfico de 12px e alto contraste.
 */
export function StatusChip({
  label,
  icon,
  tone = "neutral",
  ghost,
  className,
  ...rest
}: StatusChipProps) {
  const classes = cx(
    "ds-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap",
    ghost ? ghostTone[tone] : softTone[tone],
    className,
  );
  return (
    <span {...rest} className={classes} {...toneAttr(tone)}>
      {icon != null ? (
        icon
      ) : (
        <span className="ds-dot inline-block size-1.5 shrink-0 rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}
