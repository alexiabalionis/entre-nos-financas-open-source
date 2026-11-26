"use client";
import {
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Area,
  Line,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { useChartAnimation } from "./use-motion.ts";
import { ChartFrame, type LegendItem } from "./chart-frame";
import { splitSeriesAt } from "./chart-data";

/** Ponto da série. x é o rótulo do eixo, v o valor. */
type TrendPoint = { x: string | number; v: number };

/**
 * Eixo Y do menor ao maior valor. Série reta (nada muda no período) abre o
 * eixo até a faixa-limite, para a linha não ficar em cima dela no meio.
 */
function flatDomain(limit: number | undefined) {
  return ([lo, hi]: readonly [number, number]): [number, number] => {
    if (lo !== hi) return [lo, hi];
    const edge = limit ?? lo - 1;
    return edge < lo ? [edge, hi] : [lo, edge === hi ? hi + 1 : edge];
  };
}

type TrendChartProps = {
  data: TrendPoint[];
  /** Valor de x onde a série vira projeção (tracejado). Default: último ponto. */
  splitAt?: string | number;
  /** Faixa-limite horizontal (ex.: margem/orçamento). */
  threshold?: { value: number; label?: string };
  /** Ponto destacado (ex.: hoje). */
  point?: { x: string | number; v: number; label?: string };
  /** Linhas verticais de marcação. */
  markers?: Array<{ x: string | number; label?: string }>;
  height?: number;
  aria?: string;
  /** Anima entrada e troca de dados (respeita movimento reduzido). */
  animate?: boolean;
  empty?: boolean;
  emptyText?: string;
  /** Legenda própria (ex.: série só realizada). Ausente: realizado + projeção. */
  legend?: LegendItem[];
};

/**
 * Série temporal com trecho realizado (sólido + área) e projeção (tracejado),
 * dividida em splitAt. Pode ter faixa-limite, ponto destacado e marcadores.
 * Só compõe ChartFrame + recharts; as cores vêm dos tokens do frame.
 */
export function TrendChart({
  data,
  splitAt,
  threshold,
  point,
  markers = [],
  height = 160,
  aria,
  animate,
  empty,
  emptyText,
  legend: custom,
}: TrendChartProps) {
  const motion = useChartAnimation(animate);
  // sólido até o split, tracejado a partir do split (sobrepõem no ponto do split
  // para a linha não quebrar). null fora da faixa → connectNulls ignora.
  const merged = splitSeriesAt(data, splitAt);

  const legend: LegendItem[] = custom ?? [
    { label: "realizado", color: "var(--family-accent)" },
    { label: "projeção", color: "var(--family-accent)", dash: true },
  ];
  if (threshold && !custom)
    legend.push({
      label: threshold.label || "margem",
      color: "var(--family-danger)",
      dash: true,
    });

  return (
    <ChartFrame
      height={height}
      legend={legend}
      aria={aria}
      empty={empty}
      emptyText={emptyText}
    >
      {(t) => (
        <ComposedChart
          data={merged}
          margin={{ top: 10, right: 8, left: 8, bottom: 2 }}
        >
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey="x"
            tickLine={false}
            axisLine={{ stroke: t.axis }}
            tick={{ fontSize: 10, fill: t.label }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis hide domain={flatDomain(threshold?.value)} />
          <Area
            type="monotone"
            dataKey="vs"
            stroke="none"
            fill={t.accent}
            fillOpacity={0.14}
            connectNulls
            {...motion}
          />
          <Line
            type="monotone"
            dataKey="vs"
            stroke={t.accent}
            strokeWidth={2.5}
            dot={false}
            connectNulls
            {...motion}
          />
          <Line
            type="monotone"
            dataKey="vd"
            stroke={t.accent}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            {...motion}
          />
          {threshold ? (
            <ReferenceLine
              y={threshold.value}
              stroke={t.danger}
              strokeDasharray="2 3"
            />
          ) : null}
          {point ? (
            <ReferenceDot
              x={point.x}
              y={point.v}
              r={4}
              fill={t.surface}
              stroke={t.danger}
              strokeWidth={2.5}
            />
          ) : null}
          {markers.map((m, i) => (
            <ReferenceLine key={i} x={m.x} stroke={t.axis} />
          ))}
        </ComposedChart>
      )}
    </ChartFrame>
  );
}
