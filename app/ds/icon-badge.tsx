"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, toneAttr, type Size, type Tone, type Toned } from "./shared";

type IconBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  Toned & {
    /** Glifo: emoji, letra ou SVG. */
    icon: ReactNode;
    size?: Size;
    /** Fundo sólido no tom em vez do fundo rebaixado. */
    solid?: boolean;
  };

const softTone: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  accent: "bg-accent-soft text-accent-ink",
  neutral: "bg-surface-2 text-muted",
};

const solidTone: Record<Tone, string> = {
  ok: "bg-ok text-white",
  warn: "bg-warn text-white",
  danger: "bg-danger text-white",
  accent: "bg-accent text-on-accent",
  neutral: "bg-ink text-surface",
};

/**
 * Emblema circular tonal com um glifo no centro.
 */
export function IconBadge({
  icon,
  tone = "neutral",
  size = "md",
  solid,
  className,
  ...rest
}: IconBadgeProps) {
  const hasCat = "data-cat" in rest;
  const classes = cx(
    "ds-badge inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none",
    size === "sm" ? "size-6 text-xs sm" : size === "lg" ? "size-10 text-base lg" : "size-8 text-xs",
    !hasCat && (solid ? solidTone[tone] : softTone[tone]),
    solid && "solid",
    className,
  );
  return (
    <span {...rest} className={classes} {...toneAttr(tone)}>
      {icon}
    </span>
  );
}
