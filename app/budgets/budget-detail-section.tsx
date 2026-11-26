"use client";
import { Row } from "../ds/row";
import { StatusChip } from "../ds/status-chip";
import { diffLabel, type DetailRow } from "./budget-detail-model.ts";
import type { Money } from "./budget-view-model.ts";

/** Lista do detalhe: "Já gastou" (feito) ou "Ainda vai pagar" (a fazer). */
export function BudgetDetailSection({
  title,
  total,
  rows,
  done,
  empty,
  fmt,
}: {
  title: string;
  total: bigint;
  rows: DetailRow[];
  done: boolean;
  empty: string;
  fmt: Money;
}) {
  return (
    <>
      <h3 className="flex items-center justify-between text-sm font-semibold">
        {title}
        <span>{fmt(total)}</span>
      </h3>
      <div className="ds-list list gap-0">
        {rows.length === 0 && <p className="ds-caption">{empty}</p>}
        {rows.map((r) => (
          <Row
            key={r.key}
            bordered
            icon={done ? "✓" : "○"}
            tone={done ? "ok" : "neutral"}
            title={r.title}
            sub={r.sub}
            trail={fmt(r.cents)}
          >
            {(r.fixed || r.diff !== null) && (
              <span className="flex flex-wrap gap-1.5">
                {r.fixed && <StatusChip ghost tone="accent" icon="↻" label="Fixa" />}
                {r.diff !== null && (
                  <StatusChip tone="warn" icon="▲" label={diffLabel(r.diff, fmt)} />
                )}
              </span>
            )}
          </Row>
        ))}
      </div>
    </>
  );
}
