"use client";
// "Caminho do saldo": saldo atual das contas + projeção dia a dia até o
// próximo salário (ou o placeholder honesto sem saldo/projeção). Extraído de
// month-screen.tsx (Etapa 2).
import { Panel } from "../../ds/panel.tsx";
import { StatBanner } from "../../ds/stat-banner.tsx";
import { TrendChart } from "../../ds/trend-chart.tsx";
import type { MonthBlockProps } from "./types.ts";
import { countUpMoney } from "./money.tsx";

export function PathBlock({ model, currency }: MonthBlockProps) {
  if (!model.show.path) return null;
  const { balancePath } = model;
  if (model.hidden)
    return (
      <Panel title="Caminho do saldo" className="mb-0">
        <p className="ds-caption">Valores ocultos.</p>
      </Panel>
    );
  return (
    <Panel title="Caminho do saldo" meta={balancePath.meta} className="mb-0">
      {balancePath.startBanner ? (
        <StatBanner
          eyebrow="Nas contas agora"
          value={countUpMoney(balancePath.startBanner.cents, currency, model.hidden)}
          neg={balancePath.startBanner.neg}
          caption={balancePath.startBanner.caption}
        />
      ) : null}
      {balancePath.chart ? (
        <TrendChart
          data={balancePath.chart.path}
          splitAt={balancePath.chart.splitAt}
          threshold={{ value: 0, label: "zero" }}
          point={balancePath.chart.point}
          aria="saldo previsto dia a dia até o próximo salário"
          empty={balancePath.chart.empty || model.hidden}
          emptyText={model.hidden ? "Valores ocultos." : "Sem movimentos previstos no período."}
        />
      ) : balancePath.placeholder ? (
        <p className="ds-caption">
          Informe o saldo da conta para a gente projetar o caminho.
        </p>
      ) : null}
    </Panel>
  );
}
