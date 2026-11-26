"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Tokens de cor lidos do tema em runtime. Nenhum hex cru no código: o valor
 * vem sempre do CSS (--family-*), então respeita tema claro/escuro E o accent
 * por pessoa que o family.tsx sobrescreve em runtime.
 */
export type ChartTokens = {
  accent: string;
  danger: string;
  ok: string;
  track: string;
  grid: string;
  axis: string;
  label: string;
  surface: string;
  cat: string[];
};

/** Item da legenda textual. dash = linha tracejada; senão amostra sólida. */
export type LegendItem = { label: string; color: string; dash?: boolean };

type ChartFrameProps = {
  /** Altura do container em px (default 160). */
  height?: number;
  /** Legenda textual própria (sem a legenda nativa do recharts). */
  legend?: LegendItem[];
  /** Mostra o estado vazio em vez do gráfico. */
  empty?: boolean;
  emptyText?: string;
  /** Descrição acessível do gráfico (vai no aria-label). */
  aria?: string;
  /** Render-prop: recebe os tokens lidos e devolve a árvore recharts. */
  children: (tokens: ChartTokens) => ReactNode;
};

/**
 * Fallback neutro para o primeiro render (SSR e antes do useEffect). Não usa
 * getComputedStyle no topo do módulo — isso quebraria o SSR —, então começa
 * com tokens vazios e lê o tema real depois que monta no browser.
 */
const FALLBACK: ChartTokens = {
  accent: "",
  danger: "",
  ok: "",
  track: "",
  grid: "",
  axis: "",
  label: "",
  surface: "",
  cat: ["", "", "", "", "", ""],
};

/** Lê um custom property do :root (só existe no browser). */
function read(): ChartTokens {
  const v = (n: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    accent: v("--family-accent"),
    danger: v("--family-danger"),
    ok: v("--family-success"),
    track: v("--family-track"),
    grid: v("--family-chart-grid"),
    axis: v("--family-chart-axis"),
    label: v("--family-chart-label"),
    surface: v("--family-surface"),
    cat: [1, 2, 3, 4, 5, 6].map((i) => v(`--family-cat-${i}`)),
  };
}

/**
 * Enquadra todo gráfico do projeto num só lugar: estados vazio/normal, altura
 * definida (sem auto-loop do recharts), legenda textual própria (sem tooltip
 * nem legenda nativos) e os tokens de cor lidos do tema. Os quatro primitivos
 * de gráfico só compõem este frame — ninguém importa recharts fora daqui.
 */
export function ChartFrame({
  height = 160,
  legend,
  empty,
  emptyText = "Sem dados para mostrar.",
  aria = "",
  children,
}: ChartFrameProps) {
  // tokens via estado: fallback no SSR/primeiro paint, tema real após montar.
  const [tokens, setTokens] = useState<ChartTokens>(() => FALLBACK);
  useEffect(() => {
    setTokens(read());
    // o tema é trocado via documentElement.dataset.theme (data-theme) e o accent
    // por pessoa via documentElement.style.setProperty('--family-accent', ...);
    // relê os tokens quando qualquer um desses muda em runtime.
    const observer = new MutationObserver(() => setTokens(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  const legendEl =
    legend && legend.length ? (
      <div className="legend">
        {legend.map((l, i) => (
          <span key={i}>
            {l.dash ? (
              <i className="dash" style={{ borderColor: l.color }} />
            ) : (
              <span className="sw" style={{ background: l.color }} />
            )}
            {l.label}
          </span>
        ))}
      </div>
    ) : null;

  const body = empty ? (
    <div className="empty">{emptyText}</div>
  ) : (
    <div className="frame" role="img" aria-label={aria}>
      <ResponsiveContainer width="100%" height={height}>
        {children(tokens)}
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="ds-chart">
      {body}
      {legendEl}
    </div>
  );
}
