"use client";
import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChangedText } from "./animated-money.tsx";
import { Icon } from "./icon.tsx";
import { columnAt, flagAt, laneFill } from "./lane-tracks-model.ts";
import { cx } from "./shared.ts";
import type { Lane } from "./types.ts";
import { useTween } from "./use-motion.ts";

export type { Lane } from "./types.ts";

/** Posição horizontal (0–1 da área dos trilhos) dentro do grupo, como o cursor. */
const along = (fraction: number) =>
  `calc(var(--lane-label) + (100% - var(--lane-label) - var(--lane-end)) * ${fraction})`;

/**
 * Um trilho por item: a barra vai do início até o ponto final (ou além do
 * horizonte) e um cursor vertical marca a coluna selecionada. Clicar no trilho
 * seleciona a coluna. Com `columnLabels`, o cursor leva a etiqueta da coluna
 * selecionada, o mouse mostra a coluna de destino antes do clique, e cada
 * trilho vira um controle deslizante de teclado (setas, Home/End). `axis`
 * marca algumas colunas embaixo (ex.: virada de ano). Não sabe o que cada
 * trilho representa.
 */
export function LaneTracks({
  label,
  lanes,
  columns,
  selected,
  onSelect,
  columnLabels,
  columnTitles,
  axis,
}: {
  label: string;
  lanes: Lane[];
  columns: number;
  selected: number;
  onSelect: (i: number) => void;
  /** Rótulo curto de cada coluna (ex.: "dez/26"). */
  columnLabels?: string[];
  /** Rótulo por extenso de cada coluna, para o leitor de tela. */
  columnTitles?: string[];
  axis?: { index: number; label: string }[];
}) {
  const fills = useTween(lanes.map((l) => laneFill(l.end, columns)), 460);
  const flags = useTween(lanes.map((l) => flagAt(l.end, columns) ?? 1), 460);
  const cursor = useTween([columns > 0 ? (selected + 0.5) / columns : 0], 380)[0];
  const [hover, setHover] = useState<number | null>(null);
  const tagged = columnLabels !== undefined && columns > 0;
  const center = (i: number) => (i + 0.5) / columns;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.width > 0 ? columnAt((e.clientX - rect.left) / rect.width, columns) : null;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? selected - 1
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? selected + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? columns - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(columns - 1, next));
    if (clamped !== selected) onSelect(clamped);
  };

  return (
    <div
      className={cx("ds-reset", "ds-lanes", tagged && "has-tags", axis && axis.length > 0 && "has-axis")}
      role="group"
      aria-label={label}
    >
      {lanes.map((l, k) => {
        const hasFlag = flagAt(l.end, columns) !== null;
        const passed = l.end !== null && selected >= l.end;
        return (
          <div key={l.key} className="ds-lanes-lane" style={{ "--lane-color": l.color } as CSSProperties}>
            <span className="ds-lanes-name">{l.label}</span>
            <div
              className="ds-lanes-track"
              {...(tagged
                ? {
                    role: "slider",
                    tabIndex: 0,
                    "aria-label": `${l.label}: mês`,
                    "aria-valuemin": 0,
                    "aria-valuemax": columns - 1,
                    "aria-valuenow": selected,
                    "aria-valuetext": columnTitles?.[selected] ?? columnLabels[selected],
                    onKeyDown: onKey,
                  }
                : {})}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                onSelect(columnAt((e.clientX - rect.left) / rect.width, columns));
              }}
              onPointerMove={tagged ? (e) => e.pointerType === "mouse" && setHover(pick(e)) : undefined}
              onPointerLeave={tagged ? () => setHover(null) : undefined}
            >
              <span className="ds-lanes-run" style={{ width: `${(fills[k] ?? 0) * 100}%` }} />
              {hasFlag ? (
                <span
                  className="ds-lanes-flag"
                  style={{ left: `${(flags[k] ?? 0) * 100}%` }}
                  data-passed={passed || undefined}
                  aria-hidden
                >
                  <Icon name="flag" size={13} />
                </span>
              ) : (
                <span className="ds-lanes-beyond" aria-hidden>
                  <Icon name="right" size={13} />
                </span>
              )}
            </div>
            <span className="ds-lanes-end">
              <ChangedText value={l.endLabel} />
            </span>
          </div>
        );
      })}
      {axis && axis.length > 0 && columns > 0 ? (
        <div className="ds-lanes-axis" aria-hidden>
          {axis.map((a) => (
            <span key={a.index} className="ds-lanes-axis-mark" style={{ left: along(a.index / columns) }}>
              {a.label}
            </span>
          ))}
        </div>
      ) : null}
      {tagged && hover !== null && hover !== selected ? (
        <>
          <span className="ds-lanes-cursor is-hover" aria-hidden style={{ left: along(center(hover)) }} />
          <span className="ds-lanes-tag is-hover" aria-hidden style={{ left: along(center(hover)) }}>
            {columnLabels[hover]}
          </span>
        </>
      ) : null}
      <span className="ds-lanes-cursor" aria-hidden style={{ left: along(cursor) }} />
      {tagged ? (
        <span key={selected} className="ds-lanes-tag" aria-hidden style={{ left: along(cursor) }}>
          {columnLabels[selected]}
        </span>
      ) : null}
    </div>
  );
}
