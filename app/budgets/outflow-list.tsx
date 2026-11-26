"use client";
import { useId } from "react";
import { Collapse } from "../ds/collapse";
import type { Money } from "./budget-view-model.ts";
import type { OutflowRowModel } from "./outflow-model.ts";
import { OutflowRow } from "./outflow-row";

type RowActions = {
  fmt: Money;
  month: string;
  hidden: boolean;
  reader: boolean;
  onDetail: (categoryId: string) => void;
  onForm: (categoryId: string, cents?: bigint) => void;
};

/** Lista das categorias: as principais e, recolhidas, as pequenas. */
export function OutflowList({
  main,
  rest,
  openKey,
  restOpen,
  onToggleRow,
  onToggleRest,
  actions,
}: {
  main: OutflowRowModel[];
  rest: OutflowRowModel[];
  openKey: string | null;
  restOpen: boolean;
  onToggleRow: (key: string) => void;
  onToggleRest: () => void;
  actions: RowActions;
}) {
  const restId = useId();
  const row = (r: OutflowRowModel) => (
    <OutflowRow
      key={r.key}
      row={r}
      open={r.key === openKey}
      onToggle={() => onToggleRow(r.key)}
      {...actions}
    />
  );
  return (
    <div className="flex flex-col">
      {main.map(row)}
      {rest.length > 0 && (
        <div className="border-t border-base-300">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={restOpen}
            aria-controls={restId}
            onClick={onToggleRest}
          >
            {restOpen ? "Esconder" : "Mostrar mais"} {rest.length} categorias
            pequenas
            <span className="ds-collapse-arrow" aria-hidden="true">
              ↓
            </span>
          </button>
          <Collapse id={restId} open={restOpen}>
            {rest.map(row)}
          </Collapse>
        </div>
      )}
    </div>
  );
}
