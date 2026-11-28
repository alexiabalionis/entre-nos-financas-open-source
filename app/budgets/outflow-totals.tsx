"use client";
import type { Money } from "./budget-view-model.ts";

/** Os dois totais do mês lado a lado, com a mesma cor da barra do teto. */
export function OutflowTotals({
  totals,
  fmt,
}: {
  totals: { spent: bigint; open: bigint };
  fmt: Money;
}) {
  return (
    <dl className="m-0 grid grid-cols-2 divide-x divide-border rounded-2xl border border-border bg-surface-2/50">
      <div className="px-3.5 py-2.5">
        <dt className="flex items-center gap-2 text-xs font-medium text-muted">
          <span
            className="size-2.5 shrink-0 rounded-[3px] bg-accent"
            aria-hidden="true"
          />
          Já gastou
        </dt>
        <dd className="m-0 mt-0.5 font-numeric text-lg font-semibold text-ink tabular-nums">
          {fmt(totals.spent)}
        </dd>
      </div>
      <div className="px-3.5 py-2.5">
        <dt className="flex items-center gap-2 text-xs font-medium text-muted">
          <span
            className="size-2.5 shrink-0 rounded-[3px] border border-accent/30 bg-accent-soft"
            aria-hidden="true"
          />
          Ainda vai pagar
        </dt>
        <dd className="m-0 mt-0.5 font-numeric text-lg font-semibold text-ink tabular-nums">
          {fmt(totals.open)}
        </dd>
      </div>
    </dl>
  );
}
