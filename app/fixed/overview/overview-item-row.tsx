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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface-2/60 p-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-sm font-semibold text-ink">{title}</p>
        {sub && <p className="m-0 text-xs text-muted">{sub}</p>}
        {chips}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {trail && (
          <p className="m-0 font-numeric text-sm font-semibold tabular-nums text-ink">
            {trail}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
