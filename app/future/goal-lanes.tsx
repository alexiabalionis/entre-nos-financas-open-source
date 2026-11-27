"use client";
import { monthLong, monthShort } from "../../src/domain/future-months.ts";
import { LaneTracks } from "../ds/index.ts";
import { Panel } from "../ds/panel.tsx";
import { useFutureContext } from "./future-context.tsx";
import { goalLanes } from "./view-model.ts";

export function GoalLanes({ title = "Cada objetivo no tempo" }: { title?: string }) {
  const f = useFutureContext();
  const result = f.draft ?? f.base;
  const input = f.draftInput;
  if (!result || !input) return null;
  const columns = Math.min(f.months, result.rows.length);
  const lanes = goalLanes(input, result, columns, f.hidden);
  const months = result.rows.slice(0, columns).map((r) => r.month);
  const axis = months.flatMap((m, i) =>
    i > 0 && m.endsWith("-01") ? [{ index: i, label: monthShort(m) }] : [],
  );
  return (
    <Panel title={title} className="mb-0">
      {lanes.length === 0 ? (
        <p className="ds-caption">Nenhum objetivo ativo ainda.</p>
      ) : (
        <LaneTracks
          label={title}
          lanes={lanes}
          columns={columns}
          selected={f.selected}
          onSelect={f.select}
          columnLabels={months.map(monthShort)}
          columnTitles={months.map(monthLong)}
          axis={axis}
        />
      )}
    </Panel>
  );
}
