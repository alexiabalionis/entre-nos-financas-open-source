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
    <dl className="stats w-full">
      <div className="stat px-3 py-2">
        <dt className="stat-title flex items-center gap-2 whitespace-normal">
          <span className="budget-sw is-spent" aria-hidden="true" />
          Já gastou
        </dt>
        <dd className="stat-value text-lg tabular-nums [font-family:var(--family-font-numeric)]">
          {fmt(totals.spent)}
        </dd>
      </div>
      <div className="stat px-3 py-2">
        <dt className="stat-title flex items-center gap-2 whitespace-normal">
          <span className="budget-sw is-planned" aria-hidden="true" />
          Ainda vai pagar
        </dt>
        <dd className="stat-value text-lg tabular-nums [font-family:var(--family-font-numeric)]">
          {fmt(totals.open)}
        </dd>
      </div>
    </dl>
  );
}
