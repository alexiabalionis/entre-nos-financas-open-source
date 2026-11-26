"use client";
// "Precisa de você": lacunas/pendências por prioridade. Extraído de
// month-screen.tsx (Etapa 2). Só renderiza com show.gaps E linhas.
import { Panel } from "../../ds/panel.tsx";
import { RowList } from "../../ds/row-list.tsx";
import type { MonthBlockProps } from "./types.ts";

export function PendingBlock({ model }: MonthBlockProps) {
  if (!model.show.gaps || model.pendingRows.length === 0) return null;
  return (
    <Panel title="Precisa de você" meta="por prioridade">
      <RowList rows={model.pendingRows} />
    </Panel>
  );
}
