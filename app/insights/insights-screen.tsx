"use client";
// Hábitos: escolha inicial do que explorar (O que chama atenção / Quanto entra
// e quanto sai / Para onde vai o dinheiro / Investimentos) com sub-telas focadas.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { handToJudite } from "../chat/handoff.ts";
import { Button } from "../ds/button.tsx";
import { Icon, type IconName } from "../ds/icon.tsx";
import { InsightCard, type InsightTone } from "../ds/insight-card.tsx";
import { ProgressiveReveal } from "../ds/progressive-reveal.tsx";
import { SplitMeter, type SplitMeterSegment } from "../ds/split-meter.tsx";
import { Stat, Stats } from "../ds/stat.tsx";
import { TopicHub, type TopicHubItem } from "../ds/topic-hub.tsx";
import type { Category } from "../month/model.ts";
import { moneyOf } from "../copilot/money.ts";
import { InvestmentsPanel } from "../copilot/investments-panel.tsx";
import { monthTitle } from "../lib/dates.ts";
import { useInsights } from "../hooks/use-insights.ts";
import { useInvestments } from "../hooks/use-investments.ts";
import type { InsightsWire } from "../../src/server/insights.ts";
import { CategoryPanel } from "./category-panel.tsx";
import { InOutPanel } from "./in-out-panel.tsx";
import { LiveMoney } from "./live-money.tsx";
import { PlacesPanel } from "./places-panel.tsx";
import {
  anchorCopy,
  categoryReading,
  daysReading,
  fixedReading,
  inOutReading,
  placesReading,
  type Money,
} from "./model.ts";

type HabitView = "insights" | "flow" | "where" | "investments";
const VALID_VIEWS = new Set<HabitView>(["insights", "flow", "where", "investments"]);

export function InsightsScreen({
  month,
  hidden,
  categories,
}: {
  month: string;
  hidden: boolean;
  categories: Category[];
}) {
  const router = useRouter();
  const [view, setView] = useState<HabitView | null>(null);
  const { data, error, reload, refreshing, updatedAt } = useInsights(month);
  const investments = useInvestments(month);
  const brlPositions = (investments?.positions ?? []).filter((p) => p.currency === "BRL");
  const hasInvestments = brlPositions.length > 0;
  const money = moneyOf(hidden);
  const colorByName = new Map(categories.map((c) => [c.name, c.colorIndex ?? null]));

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("ver") as HabitView | null;
    if (raw && VALID_VIEWS.has(raw)) setView(raw);
  }, []);

  const pickView = useCallback((next: HabitView | null) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete("ver");
    else url.searchParams.set("ver", next);
    history.replaceState(history.state, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const fixedSplit = data ? buildFixedSplit(data, hidden, money) : null;
  const highlights = data ? buildInsights(data, hidden, money) : [];

  const hubItems: TopicHubItem<HabitView>[] = data
    ? [
        {
          id: "insights",
          tone: "accent",
          icon: <Icon name="sparkle" size={18} />,
          title: "O que chama atenção",
          description:
            "Descobertas sobre pequenos gastos, o que subiu e o ritmo dos últimos meses.",
          meta: hidden
            ? "Valores ocultos"
            : highlights.length > 0
              ? `${highlights.length} ${highlights.length === 1 ? "descoberta pronta" : "descobertas prontas"}`
              : "Tudo dentro do ritmo",
        },
        {
          id: "flow",
          tone: "ok",
          icon: <Icon name="in" size={18} />,
          title: "Quanto entra e quanto sai",
          description:
            "Médias dos meses fechados, comparação mensal e quanto costuma sobrar.",
          meta: hidden
            ? "Valores ocultos"
            : data.summary
              ? `${BigInt(data.summary.keptAvg) >= 0n ? "Sobra média" : "Diferença média"}: ${money(BigInt(data.summary.keptAvg))}/mês`
              : "Aguardando 1º mês fechado",
        },
        {
          id: "where",
          tone: "warn",
          icon: <Icon name="layers" size={18} />,
          title: "Para onde vai o dinheiro",
          description:
            "Lugares que mais pesam, gastos por categoria e divisão entre fixo e dia a dia.",
          meta: hidden
            ? "Valores ocultos"
            : data.places.quarter.length > 0
              ? `${data.places.quarter.length} lugares nos últimos 3 meses`
              : anchorCopy(data).meta,
        },
        ...(hasInvestments
          ? [
              {
                id: "investments" as const,
                tone: "neutral" as const,
                icon: <Icon name="bank" size={18} />,
                title: "Investimentos",
                description:
                  "Posições acompanhadas em reais e último saldo registrado.",
                meta: hidden
                  ? "Valores ocultos"
                  : `${brlPositions.length} ${brlPositions.length === 1 ? "posição" : "posições"}`,
              },
            ]
          : []),
      ]
    : [];

  const statusPill = data ? (
    <p
      className="m-0 inline-flex items-center gap-2 text-[0.75rem] font-medium text-ink-2"
      role="status"
      data-busy={refreshing || undefined}
    >
      <span
        className={`size-2 rounded-full ${refreshing ? "animate-pulse bg-accent" : "bg-ok"}`}
        aria-hidden="true"
      />
      {refreshing ? "atualizando…" : freshLabel(data, month, updatedAt)}
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/25 bg-danger-bg px-4 py-3 text-[0.875rem] text-danger"
        >
          <span>{error}</span>
          <Button variant="quiet" size="sm" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {!data && !error && (
        <div
          role="status"
          aria-label="Carregando seus hábitos"
          className="flex flex-col gap-5"
        >
          <span className="sr-only">Carregando seus hábitos…</span>
          <div className="h-5 w-40 animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-[168px] animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none" />
            <div className="h-[168px] animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none" />
            <div className="h-[168px] animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none" />
            <div className="h-[168px] animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none" />
          </div>
        </div>
      )}

      {data && fixedSplit && (
        <TopicHub
          items={hubItems}
          selected={view}
          onSelect={pickView}
          promptTitle="Por onde começar?"
          aside={statusPill}
          backLabel="Voltar para Hábitos"
          renderContent={(id) => {
            if (id === "insights") {
              if (hidden) {
                return (
                  <InsightCard
                    variant="card"
                    icon={<Icon name="eye" size={16} />}
                    eyebrow="Privacidade"
                    title="Valores ocultos — mostre os valores no topo para analisar seus hábitos."
                    tone="neutral"
                  />
                );
              }
              return (
                <ProgressiveReveal
                  autoStart
                  resetKey={month}
                  items={highlights}
                  getKey={(item) => item.key}
                  analyzingSteps={[
                    "Lendo os gastos do período…",
                    "Comparando com os meses anteriores…",
                    "Separando o que chama atenção…",
                  ]}
                  replayLabel="Analisar novamente"
                  emptyState={
                    <p className="m-0 text-sm text-muted">
                      Tudo dentro do ritmo habitual neste período.
                    </p>
                  }
                  renderItem={(item) => (
                    <InsightCard
                      variant="row"
                      icon={<Icon name={item.icon} size={16} />}
                      eyebrow={item.eyebrow}
                      title={item.title}
                      tone={item.tone}
                    />
                  )}
                  footer={
                    <Button
                      variant="quiet"
                      size="sm"
                      icon="sparkle"
                      onClick={() => {
                        handToJudite(
                          "Olhei nossos Hábitos. Onde estamos gastando mais do que deveríamos e onde dá para economizar sem sofrimento?",
                        );
                        router.push("/judite");
                      }}
                    >
                      Perguntar à Judite onde economizar
                    </Button>
                  }
                />
              );
            }

            if (id === "flow") {
              return (
                <>
                  {data.summary ? (
                    <Stats label="Médias dos meses fechados" columns={3}>
                      <Stat
                        icon="in"
                        tone="ok"
                        title="Entra por mês"
                        value={
                          <LiveMoney cents={BigInt(data.summary.avgIn)} hidden={hidden} />
                        }
                        caption="Salário e outras entradas"
                      />
                      <Stat
                        icon="out"
                        tone="danger"
                        title="Sai por mês"
                        value={
                          <LiveMoney cents={BigInt(data.summary.avgOut)} hidden={hidden} />
                        }
                        caption="Contas, cartão e dia a dia"
                      />
                      <Stat
                        icon="shield"
                        title="Sobra por mês"
                        value={
                          <LiveMoney
                            cents={BigInt(data.summary.keptAvg)}
                            hidden={hidden}
                          />
                        }
                        neg={!hidden && BigInt(data.summary.keptAvg) < 0n}
                        caption={
                          hidden
                            ? "Média dos meses fechados"
                            : BigInt(data.summary.keptAvg) < 0n
                              ? "Saiu mais do que entrou"
                              : "Livre por mês"
                        }
                      />
                    </Stats>
                  ) : (
                    <p className="m-0 rounded-2xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
                      Os números médios aparecem assim que fechar o primeiro mês completo.
                    </p>
                  )}
                  <InOutPanel
                    data={data}
                    money={money}
                    hidden={hidden}
                    colorByName={colorByName}
                    showCategoryToggle={false}
                  />
                </>
              );
            }

            if (id === "where") {
              return (
                <>
                  <SplitMeter
                    eyebrow={anchorCopy(data).meta}
                    title="Contas fixas e dia a dia"
                    headline={fixedSplit.headline}
                    footer={fixedSplit.footer}
                    segments={fixedSplit.segments}
                    ariaLabel="Divisão entre contas fixas e dia a dia"
                  />
                  <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                    <PlacesPanel
                      data={data}
                      money={money}
                      title="Lugares que mais pesam"
                    />
                    <CategoryPanel
                      data={data}
                      money={money}
                      hidden={hidden}
                      colorByName={colorByName}
                    />
                  </div>
                </>
              );
            }

            return <InvestmentsPanel data={investments} money={money} />;
          }}
        />
      )}
    </div>
  );
}

function buildFixedSplit(
  data: InsightsWire,
  hidden: boolean,
  money: Money,
): { headline?: string; footer: string; segments: SplitMeterSegment[] } {
  const fixedCents = BigInt(data.fixed.fixed);
  const everydayCents = BigInt(data.fixed.everyday);
  const safeFixed = fixedCents > 0n ? fixedCents : 0n;
  const safeEveryday = everydayCents > 0n ? everydayCents : 0n;
  const total = safeFixed + safeEveryday;
  const fixedPct = total > 0n ? Number((safeFixed * 100n) / total) : 0;
  const everydayPct = total > 0n ? 100 - fixedPct : 0;

  const reading = fixedReading(data);
  const headline = hidden ? undefined : money(total);
  const footer = hidden
    ? "Valores ocultos — mostre os valores no topo para ver a divisão."
    : reading || "Sem saídas neste período ainda.";

  const segments: SplitMeterSegment[] = hidden
    ? []
    : [
        {
          key: "fixed",
          label: "Contas fixas",
          percent: fixedPct,
          color: "var(--family-cat-4)",
          value: money(safeFixed),
          hint: "compromissos recorrentes",
        },
        {
          key: "everyday",
          label: "Dia a dia",
          percent: everydayPct,
          color: "var(--family-cat-6)",
          value: money(safeEveryday),
          hint: "onde dá pra ajustar",
        },
      ];

  return { headline, footer, segments };
}

type HighlightItem = {
  key: string;
  eyebrow: string;
  title: string;
  tone: InsightTone;
  icon: IconName;
};

function buildInsights(
  data: InsightsWire,
  hidden: boolean,
  money: Money,
): HighlightItem[] {
  if (hidden) return [];
  const copy = anchorCopy(data);
  const inOut = inOutReading(data, "sem");
  const candidates: HighlightItem[] = [
    {
      key: "places",
      eyebrow: "Pequenos gastos",
      title: placesReading(data.places.quarter, money),
      tone: "warn",
      icon: "card",
    },
    {
      key: "category",
      eyebrow: "Subiu neste mês",
      title: categoryReading(data.categories.month, money, copy.prevReading),
      tone: "accent",
      icon: "up",
    },
    {
      key: "days",
      eyebrow: "Dia que mais pesa",
      title: daysReading(data, money),
      tone: "neutral",
      icon: "calendar",
    },
    {
      key: "inout",
      eyebrow: "Ritmo dos meses",
      title: inOut,
      tone: inOut.startsWith("Saiu mais") ? "danger" : "ok",
      icon: inOut.startsWith("Saiu mais") ? "alert" : "check",
    },
    {
      key: "fixed",
      eyebrow: "O que dá pra ajustar",
      title: fixedReading(data),
      tone: "neutral",
      icon: "layers",
    },
  ];
  return candidates.filter((item) => item.title.length > 0);
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * De quando são os dados, em voz baixa. Mês atual: "atualizado às 11:46".
 * Mês passado: "como estava em 31/08". Mês futuro: ainda não há lançamentos.
 */
function freshLabel(
  data: { today: string; current: boolean; future: boolean },
  month: string,
  at: Date | null,
): string {
  const day = `${data.today.slice(8, 10)}/${data.today.slice(5, 7)}`;
  const time = at ? `atualizado às ${TIME.format(at)}` : "";
  if (!data.current) return `como estava em ${day}`;
  if (data.future) return `${monthTitle(month).replace(/ de \d{4}$/, "")} ainda não começou · mostrando até hoje`;
  return time || `até hoje, ${day}`;
}
