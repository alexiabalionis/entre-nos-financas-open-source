"use client";
import { BarChart, XAxis, YAxis, Bar, CartesianGrid } from "recharts";
import { useChartAnimation } from "./use-motion.ts";
import { ChartFrame } from "./chart-frame";
import { chartTooltip } from "./chart-tooltip";

/** Uma série: rótulo da legenda e cor (token CSS). */
type Series = { label: string; color: string };
/** Um grupo no eixo X: rótulo e um valor por série, na ordem de `series`. */
type Group = { label: string; values: number[] };

type GroupedBarChartProps = {
  groups: Group[];
  series: Series[];
  height?: number;
  /** Com isto, mostra o eixo Y com valores de referência (ex.: "R$ 20 mil"). */
  yFmt?: (value: number) => string;
  /** Formata o valor no tooltip (toque/hover). */
  fmt?: (value: number) => string | number;
  aria?: string;
  /** Anima entrada e troca de dados (respeita movimento reduzido). */
  animate?: boolean;
  empty?: boolean;
  emptyText?: string;
};

/**
 * Barras verticais agrupadas (ex.: entrou x saiu por mês). Só compõe
 * ChartFrame + recharts; cores vêm do chamador (tokens) e do frame.
 */
export function GroupedBarChart({
  groups,
  series,
  height = 180,
  fmt = (v) => v,
  yFmt,
  aria,
  animate,
  empty,
  emptyText,
}: GroupedBarChartProps) {
  const motion = useChartAnimation(animate);
  const data = groups.map((g) => ({
    label: g.label,
    ...Object.fromEntries(g.values.map((v, i) => [`s${i}`, v])),
  }));
  return (
    <ChartFrame
      height={height}
      legend={series}
      aria={aria}
      empty={empty}
      emptyText={emptyText}
    >
      {(t) => (
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: t.axis }}
            tick={{ fontSize: 10, fill: t.label }}
            interval={0}
          />
          {yFmt ? (
            <YAxis
              width={40}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              tick={{ fontSize: 10, fill: t.label }}
              tickFormatter={(v: number) => yFmt(v)}
            />
          ) : (
            <YAxis hide />
          )}
          {chartTooltip(t, fmt)}
          {series.map((s, i) => (
            <Bar
              key={i}
              dataKey={`s${i}`}
              name={s.label}
              fill={s.color}
              radius={[3, 3, 0, 0]}
              {...motion}
            />
          ))}
        </BarChart>
      )}
    </ChartFrame>
  );
}
