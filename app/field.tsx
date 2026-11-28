"use client";
import type { ReactNode, LabelHTMLAttributes } from "react";

type FieldProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

/**
 * Campo de formulário no padrão do projeto: `<label>` que envolve o controle.
 */
export function Field({
  label,
  children,
  hint,
  error,
  className,
  ...rest
}: FieldProps) {
  const classes = ["field flex min-w-0 flex-col gap-1.5", className]
    .filter(Boolean)
    .join(" ");
  return (
    <label {...rest} className={classes}>
      <span className="text-[0.8125rem] leading-snug font-medium text-ink">
        {label}
      </span>
      {children}
      {hint && (
        <small className="text-xs leading-normal font-normal text-muted">
          {hint}
        </small>
      )}
      {error && (
        <small className="family-error text-xs leading-normal font-normal text-danger" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
