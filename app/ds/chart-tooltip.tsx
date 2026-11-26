"use client";
import { Tooltip } from "recharts";
import type { ChartTokens } from "./chart-frame";

/**
 * Tooltip padrão dos gráficos do DS: ao tocar/passar o mouse, mostra o valor
 * de cada série no ponto, formatado pelo chamador. Cores só dos tokens do
 * tema. Chame como função (não componente) dentro do gráfico recharts, para
 * o recharts reconhecer o <Tooltip>.
 */
export function chartTooltip(
  t: ChartTokens,
  fmt: (value: number) => string | number,
) {
  return (
    <Tooltip
      cursor={{ fill: t.track, fillOpacity: 0.5 }}
      isAnimationActive={false}
      contentStyle={{
        background: t.surface,
        border: `1px solid ${t.axis}`,
        borderRadius: 10,
        fontSize: 12,
        padding: "6px 10px",
      }}
      labelStyle={{ color: t.label, marginBottom: 2 }}
      itemStyle={{ padding: 0 }}
      formatter={(value, name) => [
        typeof value === "number" ? fmt(value) : String(value ?? ""),
        String(name ?? ""),
      ]}
    />
  );
}
