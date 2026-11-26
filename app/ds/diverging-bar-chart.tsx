"use client";
import { BarChart, XAxis, YAxis, ReferenceLine, Bar, Cell } from "recharts";
import { ChartFrame } from "./chart-frame";

/** Item divergente. value negativo cai à esquerda do zero, positivo à direita. */
type DivergingItem = { label: string; value: number; color?: string };

type DivergingBarChartProps = {
  items: DivergingItem[];
  /** Escala simétrica do eixo (default: maior |value|, mínimo 1). */
  scale?: number;
  aria?: string;
  empty?: boolean;
  emptyText?: string;
};

/**
 * Barras horizontais que divergem a partir do zero (variação -/+). A escala é
 * simétrica para os dois lados ficarem comparáveis. Sem cor explícita, positivo
 * usa danger e negativo usa ok (convenção do tema, via tokens do frame).
 */
export function DivergingBarChart({
  items,
  scale,
  aria,
  empty,
  emptyText,
}: DivergingBarChartProps) {
  const max = scale || Math.max(1, ...items.map((i) => Math.abs(i.value)));

  return (
    <ChartFrame
      height={items.length * 38 + 10}
      aria={aria}
      empty={empty}
      emptyText={emptyText}
    >
      {(t) => (
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
          barCategoryGap={8}
        >
          <XAxis type="number" hide domain={[-max, max]} />
          <YAxis
            type="category"
            dataKey="label"
            width={96}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: t.label }}
          />
          <ReferenceLine x={0} stroke={t.axis} />
          <Bar dataKey="value" radius={4} isAnimationActive={false}>
            {items.map((it, i) => (
              <Cell key={i} fill={it.color || (it.value > 0 ? t.danger : t.ok)} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartFrame>
  );
}
