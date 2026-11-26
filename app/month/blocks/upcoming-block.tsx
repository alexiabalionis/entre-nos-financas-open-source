"use client";
// "Vem aí": compromissos datados em aberto. Extraído de month-screen.tsx
// (Etapa 2). Visível conforme show.upcoming (flags do mês/modo).
import { Panel } from "../../ds/panel.tsx";
import { RowList } from "../../ds/row-list.tsx";
import type { MonthBlockProps } from "./types.ts";

export function UpcomingBlock({ model }: MonthBlockProps) {
  if (!model.show.upcoming) return null;
  return (
    <Panel title="Vem aí" meta="em aberto">
      {model.hidden ? (
        <p className="ds-caption">Valores ocultos.</p>
      ) : model.upcomingRows.length > 0 ? (
        <RowList rows={model.upcomingRows} />
      ) : (
        <p className="ds-caption">Nada em aberto neste mês.</p>
      )}
    </Panel>
  );
}
