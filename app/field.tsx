"use client";
import type { ReactNode, LabelHTMLAttributes } from "react";

type FieldProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
  /** Texto do rótulo. */
  label: ReactNode;
  /** O campo em si: `<input>`, `<select>`, `<textarea>` ou um grupo. */
  children: ReactNode;
  /** Dica auxiliar sob o campo (classe `.fine` do projeto). */
  hint?: ReactNode;
  /** Mensagem de erro inline do campo. Mostrada só quando presente. */
  error?: ReactNode;
};

/**
 * Campo de formulário no padrão do projeto: um `<label>` que embrulha o campo,
 * exatamente o markup que o CSS global estiliza (coluna com rótulo em cima).
 * Não renderiza o input por dentro — recebe-o como `children` — então qualquer
 * tipo de campo e qualquer prop nativa continuam valendo.
 *
 * Cobre o caso dominante (rótulo em coluna). Checkbox/radio inline continuam
 * com suas classes de contexto do projeto (`bank-consent`, `manual-card-paid`),
 * porque o projeto não tem uma classe genérica de inline-label e criar uma
 * seria inventar estilo novo. O erro inline é opt-in e sem cor hardcoded.
 */
export function Field({
  label,
  children,
  hint,
  error,
  className,
  ...rest
}: FieldProps) {
  // Rótulo 13px em cima, 6px até o campo; dica/erro 12px abaixo. Não usa o
  // `fieldset-legend` do daisyUI: ele é feito para <legend> e traz 8px de
  // padding vertical, o que afastava rótulo e campo.
  const classes = ["field flex min-w-0 flex-col gap-1.5", className]
    .filter(Boolean)
    .join(" ");
  return (
    <label {...rest} className={classes}>
      <span className="text-[0.8125rem] leading-snug font-medium text-base-content">
        {label}
      </span>
      {children}
      {hint && (
        <small className="text-xs leading-normal font-normal text-base-content/60">
          {hint}
        </small>
      )}
      {error && (
        <small className="family-error text-xs leading-normal font-normal text-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
