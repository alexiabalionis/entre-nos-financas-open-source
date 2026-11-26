"use client";
import type { ReactNode } from "react";

/** Linha de uma conta dentro do cartão da seção: bloco suave, valor e ação à direita. */
export function OverviewItemRow({
  title,
  sub,
  trail,
  chips,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  trail?: ReactNode;
  chips?: ReactNode;
  /** Ações da linha (botões). */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-sm font-semibold">{title}</p>
        {sub && <p className="m-0 text-xs text-base-content/60">{sub}</p>}
        {chips}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {trail && <p className="m-0 text-sm font-semibold">{trail}</p>}
        {children}
      </div>
    </div>
  );
}
