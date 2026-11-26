"use client";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { barGeometry, usedLayers } from "./stacked-bars-model.ts";
import type { BarLayer } from "./types.ts";
import { useElementWidth } from "./use-element-width.ts";
import { useTween } from "./use-motion.ts";

export type { BarLayer } from "./types.ts";

const TOP = 26;
const BASE_GAP = 6;

/**
 * Barras empilhadas por coluna, com contorno tracejado de comparação e camadas
 * estimadas hachuradas. As alturas vão até o valor novo e as colunas novas
 * crescem do zero. O SVG é decorativo pra seleção: a seleção de coluna é feita
 * por botões sob o gráfico. Já o tooltip de cada pedaço é interativo mesmo (um
 * balão próprio, não o <title> nativo do navegador): passa o mouse ou toca no
 * pedaço; tocar fora fecha. Precisa ser assim porque o app roda como app iOS
 * (Capacitor) e toque não tem "hover" nenhum pra um <title> nativo aparecer.
 * Não sabe o que as camadas significam.
 */
export function StackedBars({
  label,
  columns,
  columnLabels,
  layers,
  values,
  ghost,
  selected,
  onSelect,
  footnotes,
  formatTotal,
  formatShortTotal,
  height = 240,
  minColumnWidth = 46,
  ghostLabel,
  tooltips,
  legend,
}: {
  label: string;
  columns: string[];
  columnLabels: string[];
  layers: BarLayer[];
  values: number[][];
  ghost?: (number | null)[];
  selected: number;
  onSelect: (i: number) => void;
  footnotes?: (string | null)[];
  formatTotal: (v: number) => string;
  /** Com mais de 12 colunas, o total das não selecionadas usa este formato curto (sem ele, só a selecionada mostra). */
  formatShortTotal?: (v: number) => string;
  height?: number;
  minColumnWidth?: number;
  ghostLabel?: string;
  /** Texto do tooltip de cada pedaço, por coluna e camada. Sem isso, o pedaço fica sem tooltip. */
  tooltips?: (string | null)[][];
  /** Legenda explícita (quando várias camadas devem virar uma linha só, ex. "Demais categorias"). Sem isso, a legenda sai direto de `layers`. */
  legend?: BarLayer[];
}) {
  const uid = useId().replace(/:/g, "");
  const [ref, w] = useElementWidth<HTMLDivElement>(800);
  // Ponto em coordenadas de viewport (não as do SVG): assim o balão escapa do
  // scroll horizontal do gráfico via portal, sem depender do overflow do pai.
  const [active, setActive] = useState<{ col: number; layer: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const dismiss = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setActive(null);
    };
    const close = () => setActive(null);
    document.addEventListener("pointerdown", dismiss);
    ref.current?.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      ref.current?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [active, ref]);
  const n = columns.length;
  const L = layers.length;
  const base = height - BASE_GAP;

  const target = barGeometry({ values, ghost, width: w, height, top: TOP, bottom: base, minColumnWidth });
  const flat = useTween(values.flat(), 420, "zero");
  const shown = Array.from({ length: n }, (_, c) => Array.from({ length: L }, (_, l) => flat[c * L + l] ?? 0));
  const geo = barGeometry({ values: shown, ghost, width: w, height, top: TOP, bottom: base, minColumnWidth, max: target.max });
  const { width: W, col, barW } = target;
  const k = (base - TOP) / target.max;

  const used = usedLayers(values, L);
  const hasGhost = (ghost ?? []).some((g) => g !== null && g !== undefined);
  const sel = Math.min(Math.max(0, selected), Math.max(0, n - 1));
  const activeTip = active ? tooltips?.[active.col]?.[active.layer] : null;
  // Mantém o balão dentro da tela mesmo perto da borda (coluna da esquerda
  // num celular estreito): pior caso de largura (max-width) e altura (texto
  // de várias linhas em "Demais categorias") das dimensões do CSS do balão.
  const TIP_HALF_W = 118;
  const TIP_MAX_H = 190;
  const tipPoint = active
    ? {
        left: Math.min(Math.max(active.x, TIP_HALF_W + 8), window.innerWidth - TIP_HALF_W - 8),
        top: Math.max(active.y, TIP_MAX_H + 8),
      }
    : null;

  return (
    <div className="ds-reset ds-bars">
      <div ref={ref} className="ds-bars-scroll" role="group" aria-label={label}>
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} aria-hidden>
          <defs>
            {layers.map((l, j) =>
              l.estimate ? (
                <pattern key={l.key} id={`${uid}-est-${j}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" style={{ fill: l.color }} />
                  <line x1="0" y1="0" x2="0" y2="5" className="ds-bars-hatch" />
                </pattern>
              ) : null,
            )}
          </defs>
          <rect className="ds-bars-sel" x={0} y={0} width={col} height={height} style={{ transform: `translateX(${sel * col}px)` }} />
          {Array.from({ length: n }, (_, c) => {
            const cx = (c + 0.5) * col;
            const total = geo.totals[c];
            const g = ghost?.[c];
            return (
              <g key={c} className="ds-bars-col" data-sel={c === sel || undefined}>
                {geo.rects
                  .filter((r) => r.col === c)
                  .map((r) => {
                    const tip = tooltips?.[c]?.[r.layer];
                    const isActive = active?.col === c && active?.layer === r.layer;
                    // Sempre abre (nunca fecha no próprio toque): um tap no celular
                    // dispara mouseenter+click em sequência, e um toggle fecharia
                    // o balão que acabou de abrir. Fecha só ao tocar fora, ou (no
                    // mouse) ao sair do pedaço.
                    const open = (e: { currentTarget: SVGRectElement }) => {
                      const b = e.currentTarget.getBoundingClientRect();
                      setActive({ col: c, layer: r.layer, x: b.left + b.width / 2, y: b.top });
                    };
                    return (
                      <rect
                        key={layers[r.layer].key}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={Math.max(0, r.h - 1)}
                        rx={2}
                        className={tip ? "ds-bars-piece" : undefined}
                        data-active={isActive || undefined}
                        style={{ fill: layers[r.layer].estimate ? `url(#${uid}-est-${r.layer})` : layers[r.layer].color }}
                        onMouseEnter={tip ? open : undefined}
                        onMouseLeave={tip ? () => setActive((a) => (a?.col === c && a?.layer === r.layer ? null : a)) : undefined}
                        onClick={
                          tip
                            ? (e) => {
                                e.stopPropagation();
                                open(e);
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                {g !== null && g !== undefined && Math.round(g) !== Math.round(values[c].reduce((a, x) => a + x, 0)) ? (
                  <rect className="ds-bars-ghost" x={cx - barW / 2 - 3} y={base - g * k} width={barW + 6} height={g * k} rx={3} />
                ) : null}
                {c === sel || n <= 12 || formatShortTotal ? (
                  <text
                    className={c === sel || n <= 12 ? "ds-bars-total" : "ds-bars-total is-short"}
                    x={cx}
                    y={base - total * k - 7}
                    textAnchor="middle"
                  >
                    {c === sel || n <= 12 ? formatTotal(total) : formatShortTotal!(total)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="ds-bars-base" x1={0} x2={W} y1={base} y2={base} />
        </svg>
        {tipPoint && activeTip
          ? createPortal(
              <div className="ds-bars-tip" style={{ left: tipPoint.left, top: tipPoint.top }} role="tooltip">
                {activeTip}
              </div>,
              document.body,
            )
          : null}
        <div className="ds-bars-x" style={{ width: W }}>
          {columns.map((c, i) => (
            <button
              key={i}
              type="button"
              style={{ width: col }}
              aria-pressed={i === sel}
              aria-label={columnLabels[i]}
              onClick={() => onSelect(i)}
            >
              <span>{n > 12 && i % 2 === 1 && i !== sel ? "" : c}</span>
              {footnotes?.[i] ? <small>{footnotes[i]}</small> : null}
            </button>
          ))}
        </div>
      </div>
      <ul className="ds-bars-legend" aria-label="Legenda">
        {(legend ?? layers.filter((_, j) => used[j])).map((l) => (
          <li key={l.key}>
            <span aria-hidden className={l.estimate ? "is-estimate" : undefined} style={{ "--swatch": l.color } as React.CSSProperties} />
            {l.label}
          </li>
        ))}
        {hasGhost && ghostLabel ? (
          <li>
            <span aria-hidden className="is-ghost" />
            {ghostLabel}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
