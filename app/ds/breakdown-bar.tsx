"use client";
import { useEffect, useState } from "react";
import { BarChart, XAxis, YAxis, Bar, LabelList } from "recharts";
import { ChartFrame } from "./chart-frame";
import { percentShares, pivotSegments } from "./chart-data";

/** Fatia da composição. value é o peso; color é dado do chamador. */
type Segment = { label: string; value: number; color: string };

type BreakdownBarProps = {
  segments: Segment[];
  aria?: string;
  empty?: boolean;
  emptyText?: string;
  /** Mostra o percentual de cada fatia na legenda e, quando cabe, na barra. */
  showPercent?: boolean;
  /** false omite a legenda (quando uma lista ao lado já nomeia as fatias). */
  legend?: boolean;
  /** Toque numa fatia (atalho de ponteiro; a lista é o caminho acessível). */
  onSegment?: (index: number) => void;
  /** Fatia em destaque; as outras ficam esmaecidas. */
  activeIndex?: number | null;
};

// Abaixo disso o texto não cabe na fatia; o percentual fica só na legenda.
const MIN_INLINE_PERCENT = 12;

/**
 * Barra única empilhada que mostra composição proporcional 100% (stackOffset
 * expand normaliza os pesos). Cada segmento vira uma chave sintética (s0, s1…)
 * numa linha só; a legenda textual nomeia as fatias. Cores são dado do chamador.
 */
export function BreakdownBar({
  segments,
  aria,
  empty,
  emptyText,
  showPercent = false,
  legend = true,
  onSegment,
  activeIndex = null,
}: BreakdownBarProps) {
  // uma linha com uma chave por segmento (s0..sN) — layout vertical + expand
  // transforma os pesos em proporção da largura total.
  const data = [pivotSegments(segments)];
  const pct = showPercent ? percentShares(segments.map((s) => s.value)) : [];
  // Animação de preenchimento desligada em prefers-reduced-motion — mesma
  // convenção do ChartFrame pros tokens: fallback neutro até montar no cliente.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <ChartFrame
      height={26}
      legend={
        legend
          ? segments.map((s, i) => ({
              label: showPercent ? `${s.label} ${pct[i]}%` : s.label,
              color: s.color,
            }))
          : undefined
      }
      aria={aria}
      empty={empty}
      emptyText={emptyText}
    >
      {(t) => (
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
          stackOffset="expand"
        >
          <XAxis type="number" hide />
          <YAxis type="category" hide />
          {segments.map((s, i) => (
            <Bar
              key={i}
              dataKey={"s" + i}
              stackId="a"
              fill={s.color}
              fillOpacity={activeIndex === null || activeIndex === i ? 1 : 0.35}
              cursor={onSegment ? "pointer" : undefined}
              onClick={onSegment ? () => onSegment(i) : undefined}
              // Risco de fatia-dominante virar "um bloco só": um traço fino na
              // cor da superfície entre as fatias (não um gap de layout) separa
              // visualmente mesmo quando uma categoria é 90%+ do total.
              stroke={t.surface}
              strokeWidth={segments.length > 1 ? 2 : 0}
              isAnimationActive={animate}
              animationBegin={i * 110}
              animationDuration={600}
              animationEasing="ease-out"
              radius={
                i === 0
                  ? [3, 0, 0, 3]
                  : i === segments.length - 1
                    ? [0, 3, 3, 0]
                    : 0
              }
            >
              {showPercent && pct[i] >= MIN_INLINE_PERCENT ? (
                <LabelList
                  className="ds-breakdown-pct"
                  dataKey={"s" + i}
                  position="center"
                  formatter={() => `${pct[i]}%`}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      )}
    </ChartFrame>
  );
}
