"use client";
// Gasto por categoria. "Este mês" mostra, em barra clara, os mesmos dias do
// mês passado. A cor é a fixa da categoria (categoryColor).
import { useState } from "react";
import { Panel } from "../ds/panel.tsx";
import { CompareBarChart } from "../ds/compare-bar-chart.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { categoryColor } from "../month/palette.ts";
import { toReais } from "../month/format.ts";
import { ChoiceChips } from "./choice-chips.tsx";
import { anchorCopy, categoryReading, type CategoryPeriod, type Money } from "./model.ts";


export function CategoryPanel({
  data,
  money,
  hidden,
  colorByName,
}: {
  data: InsightsWire;
  money: Money;
  hidden: boolean;
  colorByName: Map<string, number | null>;
}) {
  const [period, setPeriod] = useState<CategoryPeriod>("month");
  const rows = data.categories[period];
  const copy = anchorCopy(data);
  const periods = [["month", copy.month], ["lastMonth", copy.lastMonth], ["quarter", "3 meses"]] as const;
  const sub: Record<CategoryPeriod, string> = {
    month: copy.monthSub,
    lastMonth: copy.lastMonthSub,
    quarter: copy.quarterSub,
  };
  const reading = period === "month" && !hidden ? categoryReading(rows, money, copy.prevReading) : "";
  return (
    <Panel title="Por categoria">
      <p className="ins-sub">{sub[period]}</p>
      <ChoiceChips label="Período" options={periods} value={period} onChange={setPeriod} />
      <CompareBarChart
        aria="Gasto por categoria"
        animate
        items={rows.map((r) => ({
          label: r.name,
          value: toReais(r.cents),
          prev: r.prev === null ? undefined : toReais(r.prev),
          color: categoryColor(r.name, colorByName),
        }))}
        fmt={(v) => money(BigInt(Math.round(Number(v) * 100)))}
        labelWidth={140}
        valueLabel={period === "month" ? copy.month : "Total"}
        prevLabel={copy.prevLabel}
        empty={hidden || rows.length === 0}
        emptyText={hidden ? "Valores ocultos." : "Nenhum gasto no período."}
      />
      {reading && (
        <p className="ds-caption">
          <b>{reading}</b>
        </p>
      )}
    </Panel>
  );
}
