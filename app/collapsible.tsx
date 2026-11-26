"use client";
import {
  useEffect,
  useState,
  type ReactNode,
  type DetailsHTMLAttributes,
} from "react";

type Variant = "inline" | "card";

type CollapsibleProps = Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  "onToggle" | "children" | "open"
> & {
  /**
   * Cabeçalho clicável. No `inline` é o conteúdo do summary; no `card` é o
   * título (com `description` abaixo).
   */
  summary: ReactNode;
  /** Só no `card`: subtítulo mostrado abaixo do título. */
  description?: ReactNode;
  /** `inline` (default): summary discreto. `card`: cartão com chevron. */
  variant?: Variant;
  /** Controlado: estado aberto. Para não-controlado, use `defaultOpen`. */
  open?: boolean;
  /** Não-controlado: estado inicial. */
  defaultOpen?: boolean;
  /** Notifica a mudança de estado (aberto/fechado). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Só não-controlado: abre automaticamente quando `location.hash` começa com
   * este prefixo (ex. `"#card-"` para deep-link de cartão).
   */
  revealOnHash?: string;
  /** Só no `card`: realça a borda quando aberto (destaque de seção ativa). */
  activeBorder?: boolean;
  /** Seta do daisyUI à direita (padrão). false quando a linha já tem ação própria ali (ex. menu ⋯). */
  arrow?: boolean;
  children: ReactNode;
};

/**
 * Bloco expansível único do projeto, sobre o `<details>/<summary>` nativo
 * (acessibilidade de graça: o summary já é o controle com estado). Dois
 * visuais via `variant`:
 *
 * - `inline` (default): summary discreto dentro de formulários/listas.
 * - `card`: cartão com título, descrição opcional e chevron — substitui os
 *   antigos `HomeDisclosure` e `ProfileCard`.
 *
 * Controlado (`open` + `onOpenChange`, ex. accordion de perfil) ou
 * não-controlado (`defaultOpen`, com `revealOnHash` opcional).
 */
export function Collapsible({
  summary,
  description,
  variant = "inline",
  open,
  defaultOpen = false,
  onOpenChange,
  revealOnHash,
  activeBorder = false,
  arrow = true,
  children,
  className,
  ...rest
}: CollapsibleProps) {
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlled ? open : internalOpen;

  useEffect(() => {
    if (controlled || !revealOnHash) return;
    const reveal = () => {
      if (location.hash.startsWith(revealOnHash)) setInternalOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [controlled, revealOnHash]);

  // Visual do daisyUI (collapse + seta). As classes ui-collapsible-* ficam
  // porque as telas as usam em regras de layout.
  const classes = [
    "ui-collapsible",
    `ui-collapsible--${variant}`,
    "collapse border border-base-300 bg-base-100",
    arrow && "collapse-arrow",
    activeBorder ? "ui-collapsible--active-border open:border-primary" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <details
      {...rest}
      className={classes}
      open={isOpen}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (!controlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      {/* flex: o daisyUI põe display:block no summary e empilhava ícone,
          título e valor que as telas montam lado a lado. */}
      <summary className="collapse-title flex items-center gap-2.5">
        {variant === "card" ? (
          <span className="ui-collapsible-heading min-w-0">
            <strong className="block">{summary}</strong>
            {description && <small className="block text-xs font-normal opacity-60">{description}</small>}
          </span>
        ) : (
          summary
        )}
      </summary>
      <div
        className={
          variant === "card"
            ? "ui-collapsible-body collapse-content"
            : "collapse-content"
        }
      >
        {children}
      </div>
    </details>
  );
}
