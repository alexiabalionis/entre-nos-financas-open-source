"use client";
import type { KeyboardEvent, ReactNode } from "react";
import { IconButton } from "./icon-button.tsx";
import { railKey } from "./month-rail-model.ts";
import { cx, toneAttr } from "./shared";
import type { RailItem } from "./types.ts";

export type { RailItem } from "./types.ts";

/**
 * Fileira horizontal rolável de itens, um deles selecionado e expandido com o
 * conteúdo de `renderSelected`. Setas, Home/End e PageUp/PageDown trocam o item.
 * Não conhece o que cada item significa e nunca faz a página rolar para o lado.
 */
export function MonthRail({
  label,
  items,
  selected,
  onSelect,
  renderSelected,
  prevLabel = "Anterior",
  nextLabel = "Próximo",
}: {
  label: string;
  items: RailItem[];
  selected: number;
  onSelect: (i: number) => void;
  renderSelected: (i: number) => ReactNode;
  prevLabel?: string;
  nextLabel?: string;
}) {
  const count = items.length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const next = railKey(e.key, selected, count);
    if (next === null) return;
    e.preventDefault();
    if (next !== selected) onSelect(next);
  };

  return (
    <div className="ds-reset ds-mrail">
      <div className="ds-mrail-nav">
        <IconButton icon="left" label={prevLabel} disabled={selected <= 0} onClick={() => onSelect(selected - 1)} />
        <IconButton icon="right" label={nextLabel} disabled={selected >= count - 1} onClick={() => onSelect(selected + 1)} />
      </div>
      <div className="ds-mrail-strip" tabIndex={0} role="group" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((it, i) => {
          const marks = Math.max(0, Math.min(6, it.marks ?? 0));
          const dots = marks > 0 ? (
            <span className="ds-mrail-marks" aria-hidden>
              {Array.from({ length: marks }, (_, k) => (
                <span key={k} />
              ))}
            </span>
          ) : null;
          if (i === selected) {
            return (
              <div key={it.key} className="ds-mrail-item is-selected" data-index={i} {...toneAttr(it.tone)}>
                <div className="ds-mrail-top">
                  <span className="ds-mrail-label">{it.label}</span>
                  {it.caption ? <span className="ds-mrail-caption">{it.caption}</span> : null}
                  {dots}
                </div>
                <div key={selected} className="ds-mrail-content">
                  {renderSelected(i)}
                </div>
              </div>
            );
          }
          return (
            <button
              key={it.key}
              type="button"
              className={cx("ds-mrail-item")}
              data-index={i}
              {...toneAttr(it.tone)}
              onClick={() => onSelect(i)}
            >
              <span className="ds-mrail-label">{it.label}</span>
              {it.caption ? <span className="ds-mrail-caption">{it.caption}</span> : null}
              {dots}
            </button>
          );
        })}
      </div>
    </div>
  );
}
