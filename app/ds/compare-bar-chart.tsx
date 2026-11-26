"use client";
import { BarChart, XAxis, YAxis, Bar, Cell } from "recharts";
import { useChartAnimation } from "./use-motion.ts";
import { ChartFrame } from "./chart-frame";
import { chartTooltip } from "./chart-tooltip";

/** Item comparado. color é opcional (dado do chamador); senão usa o accent.
 *  prev (opcional) é desenhado como barra clara atrás (ex.: mesmo período
 *  anterior). */
type CompareItem = { label: string; value: number; color?: string; prev?: number };

type CompareBarChartProps = {
  items: CompareItem[];
  /** Limite superior do eixo (default: maior valor dos dados). */
  max?: number;
  /** Formata o rótulo à direita da barra. */
  fmt?: (value: number | string) => string | number;
  height?: number;
  /** Largura da coluna dos rótulos à esquerda, em px (default 92). */
  labelWidth?: number;
  /** Nomes das séries no tooltip (default "Atual" e "Anterior"). */
  valueLabel?: string;
  prevLabel?: string;
  aria?: string;
  /** Anima entrada e troca de dados (respeita movimento reduzido). */
  animate?: boolean;
  empty?: boolean;
  emptyText?: string;
};

const BAR = 12;

/**
 * Barras horizontais rotuladas para comparar grandezas (A vs B). Cada item pode
 * trazer a própria cor (dado), com fallback no accent do tema. O trilho de
 * fundo e o label à direita usam os tokens lidos pelo ChartFrame. Com `prev`,
 * a barra clara fica sobreposta atrás da barra do valor (mesma linha).
 */
export function CompareBarChart({
  items,
  max,
  fmt = (v) => v,
  height,
  labelWidth = 92,
  valueLabel = "Atual",
  prevLabel = "Anterior",
  aria,
  animate,
  empty,
  emptyText,
}: CompareBarChartProps) {
  const motion = useChartAnimation(animate);
  const withPrev = items.some((it) => it.prev != null);
  const top = max ?? Math.max(1, ...items.map((it) => Math.max(it.value, it.prev ?? 0)));
  // Valor líquido negativo (estorno maior que o gasto) precisa de espaço à esquerda do zero.
  const low = Math.min(0, ...items.map((it) => Math.min(it.value, it.prev ?? 0)));
  return (
    <ChartFrame
      height={height ?? items.length * 42 + 10}
      aria={aria}
      empty={empty}
      emptyText={emptyText}
    >
      {(t) => (
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 0, right: 84, left: 0, bottom: 0 }}
          barCategoryGap={10}
          // Sobrepõe a barra do valor à barra de `prev` (mesma altura, gap negativo).
          barGap={withPrev ? -BAR : 4}
        >
          <XAxis type="number" hide domain={[low, top]} />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: t.label }}
          />
          {chartTooltip(t, (v) => fmt(v))}
          {withPrev ? (
            <Bar
              dataKey="prev"
              name={prevLabel}
              barSize={BAR}
              radius={[0, 5, 5, 0]}
              {...motion}
              background={{ fill: t.track, radius: 5 }}
            >
              {items.map((it, i) => (
                <Cell key={i} fill={it.color || t.accent} fillOpacity={0.35} />
              ))}
            </Bar>
          ) : null}
          <Bar
            dataKey="value"
            name={valueLabel}
            barSize={withPrev ? BAR : undefined}
            radius={[0, 5, 5, 0]}
            {...motion}
            background={withPrev ? undefined : { fill: t.track, radius: 5 }}
            label={{
              position: "right",
              fontSize: 11,
              fill: t.label,
              // recharts tipa o formatter como RenderableText→RenderableText.
              // Em eixo categoria o label pode não ser número; só aplicamos o
              // fmt numérico quando a coerção é finita, senão devolvemos o texto.
              formatter: (label) => {
                const n = typeof label === "number" ? label : Number(label);
                return Number.isFinite(n) ? fmt(n) : String(label ?? "");
              },
            }}
          >
            {items.map((it, i) => (
              <Cell key={i} fill={it.color || t.accent} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartFrame>
  );
}
