"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, isIconName, type IconName } from "./icon.tsx";
import { cx } from "./shared.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "text";
/** Estados mutuamente exclusivos. loading/success/error desabilitam o clique. */
export type ButtonState = "idle" | "loading" | "success" | "error";

// As classes de variante antigas ficam porque as telas as usam em regras de
// layout (ex.: `.cop-actions .ds-button`, `.family-actions .primary`). O visual
// vem do daisyUI (btn-*), que vence o CSS antigo pela ordem das camadas.
const variantClass: Record<ButtonVariant, string> = {
  primary: "primary btn-primary",
  secondary: "ds-secondary",
  quiet: "quiet btn-soft",
  text: "text-button btn-link",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** primary: a ação principal; secondary (padrão): contornado; quiet: fundo suave; text: link de ação. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Estado da ação. loading/success/error desabilitam o botão; quem chama volta ao idle. */
  state?: ButtonState;
  /** Ícone antes do texto: nome do Icon do DS ou um nó próprio. Some nos estados. */
  icon?: IconName | ReactNode;
  /** Atalho para state="loading". */
  busy?: boolean;
  /** Rótulos por estado; sem eles, o texto não muda. */
  busyLabel?: ReactNode;
  successLabel?: ReactNode;
  errorLabel?: ReactNode;
  children: ReactNode;
};

/**
 * Botão de ação do design system, par do IconButton: texto (e ícone opcional),
 * 44px de altura mínima (36px no `sm`, com a mesma área de toque), hover,
 * pressão e foco do DS. Repassa qualquer prop nativa de `<button>`; `type` é
 * "button" por padrão. Estados: loading (spinner), success (✓) e error.
 */
export function Button({
  variant = "secondary",
  size = "md",
  state = "idle",
  icon,
  busy = false,
  busyLabel,
  successLabel,
  errorLabel,
  children,
  className,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  const current: ButtonState = busy && state === "idle" ? "loading" : state;
  const label =
    current === "loading" && busyLabel !== undefined
      ? busyLabel
      : current === "success" && successLabel !== undefined
        ? successLabel
        : current === "error" && errorLabel !== undefined
          ? errorLabel
          : children;
  const glyph =
    current === "loading" ? (
      <span className="loading loading-spinner loading-sm" aria-hidden="true" />
    ) : current === "success" ? (
      <span className="ds-button-glyph inline-flex" aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
    ) : current === "error" ? (
      <span className="ds-button-glyph inline-flex" aria-hidden="true">
        <Icon name="close" size={16} />
      </span>
    ) : icon ? (
      <span className="ds-button-icon inline-flex" aria-hidden="true">
        {typeof icon !== "string" ? (
          icon
        ) : isIconName(icon) ? (
          <Icon name={icon} size={16} />
        ) : (
          // Glifo de texto ("↻", "💳"): antes virava um <Icon> sem desenho.
          <span className="inline-block w-4 text-center leading-none">{icon}</span>
        )}
      </span>
    ) : null;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || current !== "idle"}
      className={cx(
        "ds-button btn",
        variantClass[variant],
        size === "sm" && "is-sm btn-sm",
        current === "success" && "btn-success",
        current === "error" && "btn-error",
        current !== "idle" && `is-${current}`,
        className,
      )}
      aria-busy={current === "loading" || undefined}
    >
      {glyph}
      <span className="ds-button-label">{label}</span>
    </button>
  );
}
