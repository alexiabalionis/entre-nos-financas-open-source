"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, badgeTone, solidTone, toneAttr, type Size, type Toned } from "./shared";

type IconBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  Toned & {
    /** Glifo: emoji, letra ou SVG. */
    icon: ReactNode;
    size?: Size;
    /** Fundo sólido no tom (texto em on-accent) em vez do fundo rebaixado. */
    solid?: boolean;
  };

/**
 * Quadradinho tonal com um glifo no centro. A cor vem do tom (data-tone) via
 * family.css; nunca inline. "md" é o default do CSS, então só sm/lg viram
 * classe.
 */
export function IconBadge({
  icon,
  tone,
  size,
  solid,
  className,
  ...rest
}: IconBadgeProps) {
  const classes = cx(
    // Círculo de verdade (badge é pílula por padrão: altura fixa + padding lateral).
    "ds-badge badge aspect-square justify-center rounded-full p-0",
    size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8",
    solid ? (tone ? solidTone[tone] || "badge-neutral" : "badge-neutral") : "badge-soft",
    !solid && tone && badgeTone[tone],
    size === "sm" && "badge-sm sm",
    size === "lg" && "badge-lg lg",
    solid && "solid",
    className,
  );
  return (
    <span {...rest} className={classes} {...toneAttr(tone)}>
      {icon}
    </span>
  );
}
