"use client";
// Semanas até o salário: o dia a dia igual em toda semana, mais as contas que
// vencem em cada uma.
import { Panel } from "../ds/panel.tsx";
import { RowList } from "../ds/row-list.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import { weekRows } from "./pace.ts";
import type { Money } from "./money.ts";

export function WeeksPanel({ copilot, money }: { copilot: CopilotWire; money: Money }) {
  const rows = weekRows(copilot, money);
  if (rows.length < 2) return null;
  return (
    <Panel title="Semanas até o salário" meta="dia a dia + contas">
      <RowList rows={rows} />
    </Panel>
  );
}
