"use client";
// Gasto por dia do mês, em calendário: quanto mais forte, mais saiu no dia.
import { Panel } from "../ds/panel.tsx";
import { CalendarHeat } from "../ds/calendar-heat.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { monthLabel, toReais } from "../month/format.ts";
import { daysReading, type Money } from "./model.ts";

export function DaysPanel({
  data,
  money,
  hidden,
}: {
  data: InsightsWire;
  money: Money;
  hidden: boolean;
}) {
  const month = data.today.slice(0, 7);
  // Valores ocultos: a intensidade também revelaria quanto, então fica neutra.
  const days = data.days.map((v) => (v === null ? null : hidden ? 0 : toReais(v)));
  const reading = hidden ? "" : daysReading(data, money);
  return (
    <Panel title="Gasto por dia" meta={monthLabel(month).toLowerCase()}>
      <CalendarHeat
        month={month}
        days={days}
        fmt={hidden ? undefined : (v) => money(BigInt(Math.round(v * 100)))}
        aria="Gasto de cada dia do mês"
      />
      {reading && (
        <p className="ds-caption">
          <b>{reading}</b>
        </p>
      )}
    </Panel>
  );
}
