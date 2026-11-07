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
  const classes = ["field", className].filter(Boolean).join(" ");
  return (
    <label {...rest} className={classes}>
      {label}
      {children}
      {hint && <small className="fine">{hint}</small>}
      {error && (
        <small className="family-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
