"use client";
// Saídas por categoria, mês a mês: barras empilhadas e, abaixo, a lista do
// mês escolhido. Cor fixa da categoria (categoryColor); "Outras" tem token próprio.
import { useState } from "react";
import { StackedBars } from "../ds/stacked-bars.tsx";
import { RowList } from "../ds/row-list.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { categoryColor } from "../month/palette.ts";
import { monthLabel } from "../month/format.ts";
import {
  categoryTrend,
  categoryTrendReading,
  monthBreakdown,
  OTHERS,
  shortMonth,
  trendChartValues,
  type Money,
  type MonthRange,
} from "./model.ts";

export function CategoryTrendChart({
  data,
  money,
  range,
  colorByName,
}: {
  data: InsightsWire;
  money: Money;
  range: MonthRange;
  colorByName: Map<string, number | null>;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const trend = categoryTrend(data, range);
  const current = data.today.slice(0, 7);
  const last = trend.months.length - 1;
  const selected = Math.min(picked ?? last, last);
  const colorOf = (name: string) =>
    name === OTHERS ? "var(--ui-surface-3)" : categoryColor(name, colorByName);
  const reading = categoryTrendReading(trend, money, data.today);
  return (
    <>
      <StackedBars
        label="Saídas por categoria, por mês"
        columns={trend.months.map(shortMonth)}
        columnLabels={trend.months.map(monthLabel)}
        layers={trend.layers.map((name) => ({ key: name, label: name, color: colorOf(name) }))}
        values={trendChartValues(trend)}
        selected={selected}
        onSelect={setPicked}
        footnotes={trend.months.map((m) => (data.current && m === current ? "até hoje" : null))}
        formatTotal={(v) => money(BigInt(Math.round(v * 100)))}
        formatShortTotal={(v) => money(BigInt(Math.round(v * 100)))}
        height={220}
      />
      <RowList
        rows={monthBreakdown(trend, selected, data.today).map((r) => ({
          sw: colorOf(r.name),
          title: r.name,
          sub: r.above ? "acima da média" : undefined,
          trail: `${money(r.cents)} · ${r.percent}%`,
        }))}
      />
      {reading && (
        <p className="text-[0.875rem] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">{reading}</strong>
        </p>
      )}
    </>
  );
}
