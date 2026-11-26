"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

/**
 * Busca que mora num botão de lupa e se abre num campo.
 *
 * Fechada: círculo do tamanho de um campo (40px; 44px no toque), lupa no tom
 * da marca. Aberta: o campo do DS, crescendo para ocupar a linha (flex-grow
 * animado — quem está ao lado encolhe no mesmo ritmo, sem número mágico).
 *
 * É um <label> com o <input> dentro: tocar na lupa foca o campo (ação nativa
 * do label), Tab também chega nele, e o leitor de tela anuncia "campo de
 * busca" com o rótulo — não há um botão extra a sincronizar. Fica aberta
 * enquanto tem foco OU texto; Esc limpa e fecha; o ✕ limpa e mantém o foco.
 *
 * `onOpenChange` avisa quem está ao lado (ex.: esconder os filtros que a
 * busca cobre). Estilo em styles.css (.ds-search).
 */
export function ExpandingSearch({
  value,
  onChange,
  label,
  placeholder,
  onOpenChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Rótulo acessível (lido pelo leitor de tela; não aparece). */
  label: string;
  placeholder?: string;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const open = focused || value !== "";
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  return (
    <label className={cx("ds-search input", className)} data-open={open || undefined}>
      <Icon name="search" size={18} className="ds-search-icon shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        ref={input}
        type="search"
        className="ds-search-field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          onChange("");
          input.current?.blur();
        }}
      />
      {open && value !== "" && (
        <button
          type="button"
          className="ds-search-clear btn btn-ghost btn-circle btn-xs shrink-0"
          aria-label="Limpar busca"
          // mousedown não rouba o foco do campo: limpa e continua digitando.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </label>
  );
}
