"use client";
// Bloco FIXO do topo da tela Mês (não entra no HomeBlocks reordenável da
// Etapa 4): aviso "Ainda sem previsão" + o herói (StatBanner inverted com o
// expand "Como chegamos nesse valor") + os avisos de risco/dado faltando.
// Com "ocultar valores", os textos mantêm o tamanho e saem borrados (Veil).
// Extraído de month-screen.tsx (Etapa 2).
import type { ReactNode } from "react";
import { formatted } from "../../../src/domain/format.ts";
import { Panel } from "../../ds/panel.tsx";
import { StatBanner } from "../../ds/stat-banner.tsx";
import { StatusChip } from "../../ds/status-chip.tsx";
import { Callout } from "../../ds/callout.tsx";
import { RowList } from "../../ds/row-list.tsx";
import { SegmentedBar } from "../../ds/segmented-bar.tsx";
import { Veil } from "../../ds/veil.tsx";
import { CashBanner } from "./cash-banner.tsx";
import type { MonthBlockProps } from "./types.ts";
import { countUpMoney } from "./money.tsx";

export function HeroBlock({ model, currency }: MonthBlockProps) {
  const { show, hero, hidden } = model;
  const veil = (text: string) => <Veil text={text} hidden={hidden} />;
  const heroValue: ReactNode =
    hero.valueCents !== null
      ? hidden
        ? veil(formatted(hero.valueCents, currency))
        : countUpMoney(hero.valueCents, currency)
      : veil(hero.valueText);
  const heroReason = hero.reason ? (
    <p className="ds-caption text-xs">
      <strong>{hero.reason.prefix}</strong> {veil(hero.reason.sentence)}
      {hero.reason.extraCount > 0
        ? ` E mais ${hero.reason.extraCount} ${hero.reason.extraCount === 1 ? "ponto" : "pontos"} em Precisa de você.`
        : null}
    </p>
  ) : null;
  // Breakdown "Seu mês": mora dentro do herói (expand do StatBanner) — é a
  // explicação de como chegamos no número, não um painel à parte.
  const flowBreakdown: ReactNode | null = model.breakdown ? (
    <>
      <div className="ds-stat-expand-h">
        <span>Seu mês</span>
        <span className="ds-panel-meta text-xs font-normal opacity-60">{model.breakdown.metaLabel}</span>
      </div>
      <SegmentedBar segments={model.breakdown.segments} aria={model.breakdown.aria} />
      <div className="mt-2 text-sm [&_.list-row]:px-0 [&_.list-row]:py-1.5">
        <RowList rows={model.breakdown.rows} bordered={false} />
      </div>
    </>
  ) : null;
  const heroExpand =
    flowBreakdown && !hidden
      ? { label: "Como chegamos nesse valor", content: flowBreakdown }
      : undefined;
  // Avisos que pedem atenção (saldo negativo antes do pagamento, itens sem
  // valor): valem para os dois topos.
  const alerts = (
    <>
      {model.riskAlert ? (
        <Callout
          tone="danger"
          icon="!"
          title={veil(model.riskAlert.title)}
          meta={veil(model.riskAlert.meta)}
        >
          {veil(model.riskAlert.body)}
        </Callout>
      ) : null}
      {model.unknownAlert ? (
        <Callout
          tone="warn"
          icon="?"
          title={veil(model.unknownAlert.title)}
          meta={veil(model.unknownAlert.meta)}
        >
          {veil(model.unknownAlert.body)}
        </Callout>
      ) : null}
    </>
  );
  return (
    <>
      {show.notice ? (
        <Panel title="Ainda sem previsão">
          <p className="ds-caption">
            Sem projeção para este mês ainda. A previsão vale para o mês atual e o próximo.
          </p>
        </Panel>
      ) : null}
      {show.banner && model.cash ? (
        <>
          <CashBanner card={model.cash} currency={currency} hidden={hidden} />
          {alerts}
        </>
      ) : show.banner ? (
        <>
          <StatBanner
            inverted
            eyebrow={veil(hero.eyebrow)}
            value={heroValue}
            title={hero.title}
            neg={hero.neg && !hidden}
            caption={veil(hero.caption)}
            trailing={<StatusChip tone={hidden ? "neutral" : hero.tone} label={veil(hero.toneLabel)} />}
            expand={heroExpand}
          >
            {heroReason}
          </StatBanner>
          {alerts}
        </>
      ) : null}
    </>
  );
}
