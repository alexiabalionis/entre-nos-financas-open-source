"use client";
import { Panel } from "../ds/panel.tsx";
import { RowList } from "../ds/row-list.tsx";
import { SegmentedBar } from "../ds/segmented-bar.tsx";
import { pendingText, saved, totals, type Goal } from "./model.ts";
import { GOAL_COLORS, type Money } from "./money.ts";

export function TotalPanel({ goals, money }: { goals: Goal[]; money: Money }) {
  const { total, moves } = totals(goals);
  const color = (i: number) => GOAL_COLORS[i % GOAL_COLORS.length];
  return (
    <Panel title="Total em reservas" meta={money(total)} className="mb-0">
      <p className="ds-caption">{pendingText(moves, money)}</p>
      {goals.length > 1 && (
        <>
          <SegmentedBar
            aria="Quanto há em cada objetivo"
            segments={goals.map((g, i) => ({
              value: Number(saved(g) > 0n ? saved(g) : 0n),
              color: color(i),
            }))}
          />
          <RowList
            bordered={false}
            rows={goals.map((g, i) => ({
              sw: color(i),
              title: g.name,
              trail: money(saved(g)),
            }))}
          />
        </>
      )}
    </Panel>
  );
}
