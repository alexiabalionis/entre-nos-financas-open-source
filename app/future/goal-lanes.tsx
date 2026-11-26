"use client";
import { monthLong, monthShort } from "../../src/domain/future-months.ts";
import { LaneTracks } from "../ds/index.ts";
import { Panel } from "../ds/panel.tsx";
import { useFutureContext } from "./future-context.tsx";
import { goalLanes } from "./view-model.ts";

/**
 * Um trilho por objetivo ativo, com a bandeira do mês em que completa e o
 * cursor no mês selecionado, com a etiqueta do mês (e a do mês sob o mouse). Desenha o rascunho (ou o plano, se não há). Sem
 * objetivos, só avisa. Não calcula: os trilhos vêm de goalLanes().
 */
export function GoalLanes({ title = "Cada objetivo no tempo" }: { title?: string }) {
  const f = useFutureContext();
  const result = f.draft ?? f.base;
  const input = f.draftInput;
  if (!result || !input) return null;
  const columns = Math.min(f.months, result.rows.length);
  const lanes = goalLanes(input, result, columns, f.hidden);
  const months = result.rows.slice(0, columns).map((r) => r.month);
  // Só a virada de ano marca o eixo: dá o tempo sem encher a barra de rótulos.
  const axis = months.flatMap((m, i) => (i > 0 && m.endsWith("-01") ? [{ index: i, label: monthShort(m) }] : []));
  return (
    <Panel title={title}>
      {lanes.length === 0 ? (
        <p className="ds-caption">Nenhum objetivo ativo ainda.</p>
      ) : (
        <LaneTracks
          label={title}
          lanes={lanes}
          columns={columns}
          selected={f.selected}
          onSelect={f.select}
          columnLabels={months.map(monthShort)}
          columnTitles={months.map(monthLong)}
          axis={axis}
        />
      )}
    </Panel>
  );
}
