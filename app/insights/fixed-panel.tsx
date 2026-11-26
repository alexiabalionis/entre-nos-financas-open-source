"use client";
// Fixo x dia a dia do mês, pelas categorias marcadas como fixas.
import { Panel } from "../ds/panel.tsx";
import { SegmentedBar } from "../ds/segmented-bar.tsx";
import { RowList } from "../ds/row-list.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { toWholeReais } from "../month/format.ts";
import { fixedReading, type Money, anchorCopy } from "./model.ts";

const FIXED = "var(--family-cat-4)";
const EVERYDAY = "var(--family-cat-6)";

export function FixedPanel({ data, money }: { data: InsightsWire; money: Money }) {
  const { fixed, everyday } = data.fixed;
  const reading = fixedReading(data);
  return (
    <Panel title="Fixo e dia a dia" meta={anchorCopy(data).meta}>
      <SegmentedBar
        aria="Fixo e dia a dia"
        segments={[
          { value: toWholeReais(fixed), color: FIXED },
          { value: toWholeReais(everyday), color: EVERYDAY },
        ]}
      />
      <RowList
        bordered={false}
        rows={[
          { sw: FIXED, title: "Contas fixas", sub: "categorias marcadas como fixas", trail: money(BigInt(fixed)) },
          { sw: EVERYDAY, title: "Dia a dia", sub: "o resto do que saiu", trail: money(BigInt(everyday)) },
        ]}
      />
      {reading && (
        <p className="ds-caption">
          <b>{reading}</b>
        </p>
      )}
    </Panel>
  );
}
