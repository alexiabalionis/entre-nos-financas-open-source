"use client";
import type { ReactNode } from "react";
import { useExpandHeight } from "./use-expand-height.ts";

/**
 * Conteúdo que abre e fecha com a mesma animação do StatBanner (altura e
 * opacidade). O gatilho é do chamador: um <button> com aria-expanded e
 * aria-controls apontando para `id`. Fechado, o conteúdo segue no DOM (é
 * preciso para medir a altura), mas inerte: fora do foco e do leitor de tela.
 */
export function Collapse({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
}) {
  const height = useExpandHeight(open);
  return (
    <div
      id={id}
      className="ds-collapse"
      data-open={open || undefined}
      style={height.style}
      onTransitionEnd={height.onTransitionEnd}
      inert={!open}
    >
      <div className="ds-collapse-body" ref={height.bodyRef}>
        {children}
      </div>
    </div>
  );
}
