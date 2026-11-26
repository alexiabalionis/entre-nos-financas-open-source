// Monta o MODELO pronto da tela Mês: roda analyzeMonth e decide
// projeção-vs-plano UMA vez só, devolvendo tudo que month-screen.tsx precisa
// pra só renderizar (sem `if (pv)` espalhado). Extraído de month-screen.tsx
// (Etapa 1).
import type { RowProps } from "../ds/row.tsx";
import type { Currency } from "../../src/domain/finance.ts";
import { money } from "../lib/money.ts";
import type { MonthlyItem } from "../../src/server/routine.ts";
import { analyzeMonth } from "../month-analysis.ts";
import { visibleBlocks, type ProjectionMode, type ProjectionView } from "../projection-view.ts";
import { SCENARIO_WORD } from "./copy.ts";
import { ddmm, toReais } from "./format.ts";
import { heroProps, type HeroSpec } from "./hero.ts";
import { cashCard, type CashCard } from "./cash.ts";
import {
  compositionSegments,
  gapRows,
  planFlowRows,
  planFlowSegments,
  planOpenRows,
  planPendingRows,
  projectionFlowRows,
  projectionFlowSegments,
  upcomingRows,
  type CategorySegment,
  type FlowSegment,
  type IconFor,
} from "./rows.ts";

export type Category = { id: string; name: string; colorIndex?: number | null };

type Alert = { title: string; meta: string; body: string };

type BalancePath = {
  meta: string | undefined;
  startBanner: { cents: string; neg: boolean; caption: string } | null;
  chart: {
    path: { x: string; v: number }[];
    splitAt: string | undefined;
    point: { x: string; v: number; label: string };
    empty: boolean;
  } | null;
  /** Sem projeção e sem saldo: mostra o placeholder "informe o saldo". */
  placeholder: boolean;
};

export type MonthModel = {
  /** Valores ocultos: os blocos trocam número animado e gráfico por •••• / aviso. */
  hidden: boolean;
  prevMonth: string;
  nextMonth: string;
  /** Legenda do Stepper quando o servidor não manda statusWord. */
  defaultStepperCaption: string;
  show: ReturnType<typeof visibleBlocks>;
  hero: HeroSpec;
  /** Card do mês atual (saldo nas contas até a véspera do pagamento); null
   *  fora do mês atual ou sem saldo, e o topo cai no herói antigo. */
  cash: CashCard | null;
  riskAlert: Alert | null;
  unknownAlert: Alert | null;
  compositionSegments: CategorySegment[];
  upcomingRows: RowProps[];
  pendingRows: RowProps[];
  breakdown: { metaLabel: string; aria: string; segments: FlowSegment[]; rows: RowProps[] } | null;
  balancePath: BalancePath;
};

export type BuildMonthModelInput = {
  items: MonthlyItem[];
  categories: Category[];
  month: string;
  currency: Currency;
  balanceCents?: string | null;
  projection?: ProjectionView | null;
  mode?: ProjectionMode;
  /** Ícone de categoria (componente React injetado pela tela). */
  iconFor: IconFor;
  /** "Ocultar valores" ligado: textos e valores saem com •••• no lugar do dinheiro. */
  hidden?: boolean;
};

const RISK_BODY = "Reveja os compromissos em aberto ou registre entradas que faltam.";

export function buildMonthModel(input: BuildMonthModelInput): MonthModel {
  const { items, categories, month, currency, balanceCents = null, mode = "current", hidden = false } = input;
  const pv = input.projection ?? null;
  const isFuture = mode === "future";
  const show = visibleBlocks(mode);
  const a = analyzeMonth(items, month);

  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const colorByName = new Map(categories.map((c) => [c.name, c.colorIndex ?? null]));

  const hero = heroProps({ pv, isFuture, month, analysis: a, currency });

  const riskAlert: Alert | null = pv
    ? pv.deficit
      ? {
          title: `O saldo fica negativo em ${ddmm(pv.deficit.day)}`,
          meta: `Faltam ${money(pv.deficit.cents, currency)} para cobrir as saídas`,
          body: RISK_BODY,
        }
      : null
    : a.scenario === "risco"
      ? {
          title: "As saídas passam das entradas neste mês",
          meta: `Faltam ${money(
            (BigInt(a.leftover) < 0n ? -BigInt(a.leftover) : BigInt(a.leftover)).toString(),
            currency,
          )} para fechar o plano`,
          body: RISK_BODY,
        }
      : null;

  const unknownAlert: Alert | null =
    a.unknownItems.length > 0
      ? {
          title: `${a.unknownItems.length} ${a.unknownItems.length === 1 ? "item sem valor" : "itens sem valor"}`,
          meta: "O total do mês está parcial",
          body: a.unknownItems.map((i) => i.label).join(", "),
        }
      : null;

  const composition = pv
    ? compositionSegments({ kind: "projection", categories: pv.categories }, colorByName)
    : compositionSegments({ kind: "plan", items, catById }, colorByName);

  const upcoming = pv
    ? upcomingRows(pv, month, colorByName, currency, input.iconFor, hidden)
    : planOpenRows(items, catById, currency, input.iconFor, hidden);

  const pending = pv
    ? gapRows(pv.gaps, currency, hidden)
    : planPendingRows(a.overdueItems, a.unknownItems, catById, currency, input.iconFor, hidden);

  const breakdown = !show.flow
    ? null
    : pv
      ? {
          metaLabel: "projeção",
          aria: "a pagar e estimado no mês",
          segments: projectionFlowSegments(pv.flow),
          rows: projectionFlowRows(pv.flow, currency, hidden),
        }
      : a.scenario !== "insuficiente" && a.scenario !== "futuro"
        ? {
            metaLabel: a.partial ? "parcial" : a.scenario === "encerrado" ? "realizado" : "projeção",
            aria: "entradas, saídas e sobra do mês",
            segments: planFlowSegments(a),
            rows: planFlowRows(a, currency, hidden),
          }
        : null;

  const balancePath: BalancePath = pv
    ? {
        meta: pv.path.length > 0 ? `até ${ddmm(pv.path[pv.path.length - 1].day)}` : undefined,
        startBanner:
          !isFuture && pv.start.cents !== null
            ? {
                cents: pv.start.cents,
                neg: BigInt(pv.start.cents) < 0n,
                caption: pv.start.date
                  ? `Saldo informado em ${ddmm(pv.start.date)}.`
                  : "Soma do saldo atual de todas as contas.",
              }
            : null,
        chart: {
          path: pv.path.map((p) => ({ x: ddmm(p.day), v: toReais(p.cents) })),
          splitAt: pv.path[0] ? ddmm(pv.path[0].day) : undefined,
          point: { x: ddmm(pv.hero.low.day), v: toReais(pv.hero.low.cents), label: "pior dia" },
          empty: pv.path.length === 0,
        },
        placeholder: false,
      }
    : {
        meta: balanceCents != null ? "saldo atual" : undefined,
        startBanner:
          balanceCents != null
            ? {
                cents: balanceCents,
                neg: BigInt(balanceCents) < 0n,
                caption: "Soma do saldo atual de todas as contas.",
              }
            : null,
        chart: null,
        placeholder: balanceCents == null,
      };

  return {
    hidden,
    prevMonth: a.prevMonth,
    nextMonth: a.nextMonth,
    defaultStepperCaption: a.partial ? "projeção parcial" : SCENARIO_WORD[a.scenario],
    show,
    hero,
    cash: pv && !isFuture ? cashCard(pv, currency, hidden) : null,
    riskAlert,
    unknownAlert,
    compositionSegments: composition,
    upcomingRows: upcoming,
    pendingRows: pending,
    breakdown,
    balancePath,
  };
}
