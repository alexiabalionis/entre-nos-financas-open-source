"use client";
import { useState, type ReactNode, type DetailsHTMLAttributes } from "react";

type CollapsibleProps = Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  "onToggle" | "children" | "open"
> & {
  /** Conteúdo do cabeçalho clicável (vai dentro do `<summary>`). */
  summary: ReactNode;
  /** Controlado: estado aberto. Para não-controlado, use `defaultOpen`. */
  open?: boolean;
  /** Não-controlado: estado inicial. */
  defaultOpen?: boolean;
  /** Notifica a mudança de estado (aberto/fechado). */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

/**
 * Bloco expansível sobre o `<details>/<summary>` nativo — o mesmo markup que o
 * CSS do projeto já estiliza (`.family-card details`, `.review-row > summary`,
 * etc.). Não impõe aparência própria: herda a classe de onde é usado.
 *
 * Funciona controlado (`open` + `onOpenChange`) ou não-controlado
 * (`defaultOpen`). Diferente do `HomeDisclosure` (que é um card de home com
 * botão + aria dedicados), este é o primitivo genérico de disclosure.
 */
export function Collapsible({
  summary,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...rest
}: CollapsibleProps) {
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlled ? open : internalOpen;
  return (
    <details
      {...rest}
      open={isOpen}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (!controlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
