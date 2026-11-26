"use client";
import { MonthRail } from "../ds/index.ts";
import { Panel } from "../ds/panel.tsx";
import { useFutureContext } from "./future-context.tsx";
import { StationCard } from "./station-card.tsx";
import { railItems } from "./view-model.ts";

/**
 * A jornada mês a mês: uma fileira de estações, a selecionada aberta com a
 * conta do mês (StationCard). Desenha o rascunho. Não calcula nada.
 */
export function MonthStations({ title = "Mês a mês" }: { title?: string }) {
  const f = useFutureContext();
  const result = f.draft;
  const input = f.draftInput;
  if (!result || !input || result.rows.length === 0) return null;
  const columns = Math.min(f.months, result.rows.length);
  const items = railItems(input, result, columns, f.hidden);
  return (
    <Panel title={title}>
      <MonthRail
        label="Meses da jornada"
        items={items}
        selected={Math.min(f.selected, columns - 1)}
        onSelect={f.select}
        renderSelected={(i) => <StationCard index={i} />}
      />
    </Panel>
  );
}
