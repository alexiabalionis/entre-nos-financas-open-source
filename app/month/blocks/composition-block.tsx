"use client";
// "Composição das saídas": barra por categoria. Extraído de
// month-screen.tsx (Etapa 2). Só renderiza quando há segmentos.
import { Panel } from "../../ds/panel.tsx";
import { BreakdownBar } from "../../ds/breakdown-bar.tsx";
import type { MonthBlockProps } from "./types.ts";

export function CompositionBlock({ model }: MonthBlockProps) {
  if (model.compositionSegments.length === 0) return null;
  return (
    <Panel title="Composição das saídas" meta="por categoria">
      <BreakdownBar
        showPercent
        segments={model.compositionSegments}
        aria="composição das saídas planejadas por categoria"
      />
    </Panel>
  );
}
