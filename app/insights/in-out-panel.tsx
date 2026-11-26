"use client";
// Entradas e saídas por mês (trimestre, 6 meses, ano) e, na outra visão, as
// saídas por categoria nos mesmos meses.
import { useState } from "react";
import { Panel } from "../ds/panel.tsx";
import { GroupedBarChart } from "../ds/grouped-bar-chart.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { toReais } from "../month/format.ts";
import { ChoiceChips } from "./choice-chips.tsx";
import { CategoryTrendChart } from "./category-trend-chart.tsx";
import { inOutReading, monthsIn, shortMonth, type Money, type MonthRange } from "./model.ts";

// Rótulo curto do eixo Y, em reais: "20 mil", "1,5 mi", "800". O "R$" fica
// no toque/hover da barra; no eixo ele quebraria a linha na coluna estreita.
const COMPACT = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const compactReais = (v: number) => COMPACT.format(v);

const RANGES = [["tri", "Trimestre"], ["sem", "6 meses"], ["ano", "Ano"]] as const;
const VIEWS = [["flow", "Entrou e saiu"], ["category", "Saídas por categoria"]] as const;
type View = (typeof VIEWS)[number][0];

export function InOutPanel({
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
  const [range, setRange] = useState<MonthRange>("ano");
  const [view, setView] = useState<View>("flow");
  const months = monthsIn(data, range);
  return (
    <Panel title="Entradas e saídas" meta={`últimos ${months.length} meses`}>
      {/* Visão e período numa linha (quebram só se não couberem): a área de
          controle não pode ocupar mais altura que a leitura do gráfico. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChoiceChips label="Visão" options={VIEWS} value={view} onChange={setView} />
        <ChoiceChips label="Período" options={RANGES} value={range} onChange={setRange} />
      </div>
      {view === "category" ? (
        hidden ? (
          <p className="ds-caption">Valores ocultos.</p>
        ) : (
          <CategoryTrendChart key={range} data={data} money={money} range={range} colorByName={colorByName} />
        )
      ) : (
        <>
          <GroupedBarChart
            aria="Entradas e saídas por mês"
            animate
            groups={months.map((m) => ({ label: shortMonth(m.month), values: [toReais(m.in), toReais(m.out)] }))}
            series={[
              { label: "Entrou", color: "var(--family-success)" },
              { label: "Saiu", color: "var(--family-cat-6)" },
            ]}
            empty={hidden}
            emptyText="Valores ocultos."
            fmt={(v) => money(BigInt(Math.round(v * 100)))}
            yFmt={compactReais}
          />
          <p className="ds-caption">
            <b>{inOutReading(data, range)}</b>
          </p>
        </>
      )}
    </Panel>
  );
}
