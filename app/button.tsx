"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "quiet" | "text";

const variantClass: Record<Variant, string> = {
  default: "",
  primary: "primary",
  quiet: "quiet",
  text: "text-button",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Qual estilo do projeto usar. Mapeia para as classes globais já existentes. */
  variant?: Variant;
  /** Em andamento: desabilita o botão e, se houver `busyLabel`, troca o texto. */
  busy?: boolean;
  /** Texto mostrado enquanto `busy` (ex. "Salvando…"). Sem ele, o texto não muda. */
  busyLabel?: ReactNode;
  children: ReactNode;
};

/**
 * Botão do design system do projeto. Não inventa estilo: escolhe entre as
 * classes globais (`.primary`, `.quiet`, `.text-button`, ou o `button` base) e
 * repassa qualquer prop nativa de `<button>`. `busy` integra com o padrão de
 * ação assíncrona (desabilita e opcionalmente troca o rótulo).
 */
export function Button({
  variant = "default",
  busy = false,
  busyLabel,
  children,
  className,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [variantClass[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      className={classes || undefined}
      aria-busy={busy || undefined}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
