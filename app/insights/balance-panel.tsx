"use client";
// Saldo das contas correntes no fim de cada dia (30, 90 dias, ano).
import { useState } from "react";
import { Panel } from "../ds/panel.tsx";
import { TrendChart } from "../ds/trend-chart.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { ddmm, toReais } from "../month/format.ts";
import { ChoiceChips } from "./choice-chips.tsx";
import { balanceIn, balanceReading, type BalanceRange, type Money } from "./model.ts";

const RANGES = [["d30", "30 dias"], ["d90", "90 dias"], ["ano", "Ano"]] as const;

export function BalancePanel({
  data,
  money,
  hidden,
}: {
  data: InsightsWire;
  money: Money;
  hidden: boolean;
}) {
  const [range, setRange] = useState<BalanceRange>("d90");
  const points = balanceIn(data, range);
  return (
    <Panel title="Saldo ao longo do tempo" meta="contas no fim de cada dia">
      <ChoiceChips label="Período" options={RANGES} value={range} onChange={setRange} />
      <TrendChart
        aria="Saldo das contas no fim de cada dia"
        animate
        data={points.map((p) => ({ x: ddmm(p.day), v: toReais(p.cents) }))}
        legend={[{ label: "saldo", color: "var(--family-accent)" }]}
        height={170}
        empty={hidden || points.length < 2}
        emptyText={hidden ? "Valores ocultos." : "Informe o saldo inicial das contas para ver a linha."}
      />
      {!hidden && points.length > 1 && (
        <p className="ds-caption">
          <b>{balanceReading(points, money)}</b> Pelos lançamentos registrados.
        </p>
      )}
    </Panel>
  );
}
