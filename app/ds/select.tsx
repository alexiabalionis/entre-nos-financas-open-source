"use client";
import type { SelectHTMLAttributes } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "className"> & {
  /** md (padrão): 40px, campo de formulário. sm: 32px, degrau de filtro. */
  size?: "sm" | "md";
  /** Classes do CONTÊINER (largura, flex). Padrão: largura toda. */
  className?: string;
};

/**
 * O único select do app. É o <select> nativo (seletor do sistema no iOS,
 * teclado, leitor de tela e `name`/`required` de formulário continuam de
 * graça), com o visual do DS por cima:
 *  - seta do DS (a mesma do Icon), que gira enquanto a lista está aberta;
 *  - borda que reage ao hover e anel da marca no foco;
 *  - opção vazia (value="") em tom apagado, como um placeholder;
 *  - no Chrome (appearance: base-select), a lista aberta também é do DS:
 *    itens de 36px, marcado no tom da marca e entrada com fade + deslize.
 * Estilo em styles.css (.ds-select). Repassa qualquer prop nativa.
 */
export function Select({ size = "md", className, children, ...rest }: SelectProps) {
  return (
    <span className={cx("ds-select-wrap relative flex w-full min-w-0", className)}>
      <select
        {...rest}
        className={cx("ds-select select w-full", size === "sm" && "select-sm")}
      >
        {children}
      </select>
      <Icon
        name="down"
        size={size === "sm" ? 14 : 16}
        className="ds-select-chevron pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </span>
  );
}
