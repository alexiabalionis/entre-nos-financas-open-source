"use client";
// Bloco FIXO do topo da tela Mês: aviso "Ainda sem previsão" + Branded Hero
// (StatBanner inverted com o expand "Como chegamos nesse valor") + avisos de risco/dado faltando.
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
    <p className="ds-caption m-0 text-xs leading-relaxed">
      <strong className="font-semibold text-white">{hero.reason.prefix}</strong>{" "}
      {veil(hero.reason.sentence)}
      {hero.reason.extraCount > 0
        ? ` E mais ${hero.reason.extraCount} ${hero.reason.extraCount === 1 ? "ponto" : "pontos"} em Atenção agora.`
        : null}
    </p>
  ) : null;

  const flowBreakdown: ReactNode | null = model.breakdown ? (
    <>
      <div className="ds-stat-expand-h mb-3 flex items-center justify-between text-sm font-semibold text-white">
        <span>Seu mês</span>
        <span className="text-xs font-normal text-white/75">
          {model.breakdown.metaLabel}
        </span>
      </div>
      <SegmentedBar segments={model.breakdown.segments} aria={model.breakdown.aria} />
      <div className="mt-3 text-sm">
        <RowList rows={model.breakdown.rows} bordered={false} />
      </div>
    </>
  ) : null;

  const heroExpand =
    flowBreakdown && !hidden
      ? { label: "Como chegamos nesse valor", content: flowBreakdown }
      : undefined;

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
    <div className="flex flex-col gap-3">
      {show.notice ? (
        <Panel title="Ainda sem previsão" className="mb-0">
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
            trailing={
              <StatusChip
                tone={hidden ? "neutral" : hero.tone}
                label={veil(hero.toneLabel)}
              />
            }
            expand={heroExpand}
          >
            {heroReason}
          </StatBanner>
          {alerts}
        </>
      ) : null}
    </div>
  );
}
