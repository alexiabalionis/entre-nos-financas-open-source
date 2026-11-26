"use client";
import { StackedBars } from "../ds/index.ts";
import { Panel } from "../ds/panel.tsx";
import { formatReais } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";
import { CardMonthPanel } from "./card-month-panel.tsx";
import { cardBars, cardSummary, ghostTotals } from "./view-model.ts";

/** "1,6 mil", "850": cabe no topo de uma coluna estreita. */
function shortReais(v: number, hidden: boolean): string {
  if (hidden) return "••";
  const r = Math.round(v);
  if (Math.abs(r) < 1000) return String(r);
  return `${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
}

/**
 * Fatura do cartão mês a mês, em camadas por categoria (mais estimativa,
 * valor do banco e a compra simulada à parte), com o valor no topo de cada
 * barra, o contorno do plano salvo quando há simulação e o detalhe do mês
 * selecionado ao lado. Sem cartão não mostra nada. Não calcula: usa cardBars().
 */
export function CardBillChart() {
  const f = useFutureContext();
  const result = f.draft;
  const input = f.draftInput;
  if (!result || !input || input.cards.length === 0 || result.rows.length === 0) return null;
  const n = Math.min(f.months, result.rows.length);
  const bars = cardBars(input, result, n, f.hidden);
  const summary = cardSummary(result, n, f.hidden);
  const ghost = f.dirty && f.base ? ghostTotals(f.base, result, n) : undefined;
  const selected = Math.min(f.selected, n - 1);
  return (
    <Panel title="Fatura do cartão">
      {summary ? (
          <p className="ds-caption">
            {summary.first} em {summary.firstMonth}
            {summary.low ? `; depois só parcelas e recorrentes, que caem para ${summary.low.value} em ${summary.low.month}` : ""}
            . Compras à vista no cartão entram na média do dia a dia. Barras hachuradas são estimativa.
          </p>
      ) : null}
      <div className="fut-card-bill-body">
        <div className="fut-card-bill-chart">
          <StackedBars
            label={`Fatura projetada por mês, ${n} meses`}
            columns={bars.columns}
            columnLabels={bars.columnLabels}
            layers={bars.layers}
            values={bars.values}
            ghost={ghost}
            ghostLabel="Fatura no plano atual"
            footnotes={bars.footnotes}
            selected={selected}
            onSelect={f.select}
            formatTotal={(v) => formatReais(v, f.hidden)}
            formatShortTotal={(v) => shortReais(v, f.hidden)}
            tooltips={bars.tooltips}
            legend={bars.legend}
          />
        </div>
        <CardMonthPanel index={selected} />
      </div>
    </Panel>
  );
}
