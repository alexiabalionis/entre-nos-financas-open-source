"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, isIconName, type IconName } from "./icon.tsx";
import { cx } from "./shared.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "text";
/** Estados mutuamente exclusivos. loading/success/error desabilitam o clique. */
export type ButtonState = "idle" | "loading" | "success" | "error";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "primary bg-accent text-on-accent hover:bg-accent-hover shadow-xs border border-transparent",
  secondary:
    "ds-secondary bg-surface text-ink border border-border hover:border-border-strong hover:bg-surface-2",
  quiet:
    "quiet bg-accent-soft text-accent-ink border border-transparent hover:brightness-95 dark:hover:brightness-110",
  text:
    "text-button bg-transparent text-accent-ink border border-transparent hover:underline px-1.5",
};

const stateOverride: Partial<Record<ButtonState, string>> = {
  success: "!bg-ok !text-white !border-transparent",
  error: "!bg-danger !text-white !border-transparent",
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
 * 40px no desktop / 44px no toque (34px no `sm`), hover, pressão e foco do DS.
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
      <span
        className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
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
        "ds-button ui-btn inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-[background-color,border-color,color,transform,filter] duration-150 cursor-pointer select-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        size === "sm"
          ? "is-sm min-h-8.5 px-3 text-[0.8125rem] leading-none"
          : "min-h-10 [@media(pointer:coarse)]:min-h-11 px-4 text-sm leading-none",
        variantClass[variant],
        stateOverride[current],
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
