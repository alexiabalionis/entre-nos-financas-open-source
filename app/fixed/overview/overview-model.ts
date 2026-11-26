import { monthName } from "../fixed-actions-model.ts";
import {
  amountDifference,
  fixedState,
  isSeriesBill,
  shownCents,
  stateBadge,
  type SeriesItem,
  type StatusItem,
} from "../fixed-status.ts";
import type { MonthItem } from "../../hooks/use-month-data.ts";
import { activeCaption, cardBillLabel, endLabel, frequencyDescription, nextLabel } from "./overview-copy.ts";
import type {
  Chip,
  Overview,
  OverviewOccurrence,
  OverviewSeries,
} from "./overview-types.ts";

export type SeriesPhase = "active" | "paused" | "ended";
export type SeriesSection = "monthly" | "frequent" | "other";
export type SeriesGroups = Record<SeriesSection, OverviewSeries[]>;

/** Mesma regra do servidor: pausada ou com fim no passado não gera mais contas. */
export function seriesPhase(
  series: Pick<OverviewSeries, "paused" | "end_date" | "start_date">,
  today: string,
): SeriesPhase {
  if (series.paused) return "paused";
  if (series.end_date === null) return "active";
  // Fim no passado, ou antes do início (encerrada sem nunca ter tido conta).
  return series.end_date < today || series.end_date < series.start_date ? "ended" : "active";
}

export function liveOccurrences(series: OverviewSeries): OverviewOccurrence[] {
  return series.occurrences.filter((o) => !o.archived);
}

/** Diária e semanal são agrupadas; sem nenhuma ocorrência no mês a série vai para "outros meses". */
export function sectionOf(series: OverviewSeries): SeriesSection {
  if (series.occurrences.length === 0) return "other";
  return series.frequency === "day" || series.frequency === "week"
    ? "frequent"
    : "monthly";
}

function firstDate(series: OverviewSeries): string {
  return series.occurrences[0]?.occurrence_date ?? "";
}

export function groupSeries(series: OverviewSeries[]): SeriesGroups {
  const groups: SeriesGroups = { monthly: [], frequent: [], other: [] };
  for (const s of series) groups[sectionOf(s)].push(s);
  groups.monthly.sort((a, b) => firstDate(a).localeCompare(firstDate(b)));
  return groups;
}

export function occurrenceStatus(o: OverviewOccurrence): StatusItem {
  return {
    status: o.status === "done" || o.status === "partial" ? o.status : "open",
    event_id: o.event_id,
    paid_cents: o.paid_cents,
    planned_cents: o.planned_cents,
    due_date: o.due_date,
    candidates: [],
    currency: "BRL",
  };
}

export function occurrenceCents(o: OverviewOccurrence): string | null {
  return shownCents(occurrenceStatus(o));
}

/** Situação de uma ocorrência: a mesma etiqueta do Mês, mais a diferença de valor quando paga por outro. */
export function occurrenceChips(o: OverviewOccurrence, hidden: boolean): Chip[] {
  if (o.archived) return [{ tone: "neutral", label: "Pulada" }];
  const status = occurrenceStatus(o);
  const badge = stateBadge(fixedState(status));
  const chips: Chip[] = [{ tone: badge.tone, label: badge.label }];
  const difference = amountDifference(status, hidden);
  if (difference)
    chips.push({ tone: difference.tone, label: difference.chip, icon: "▲" });
  return chips;
}

const PHASE_CHIP: Record<Exclude<SeriesPhase, "active">, Chip> = {
  paused: { tone: "neutral", label: "Pausada" },
  ended: { tone: "neutral", label: "Encerrada" },
};

export type SeriesRowModel = {
  id: string;
  title: string;
  sub: string;
  cents: string | null;
  chips: Chip[];
};

/** Linha de uma série mensal ou anual: o que repete, a próxima data e a situação do mês. */
export function seriesRow(
  series: OverviewSeries,
  today: string,
  hidden: boolean,
): SeriesRowModel {
  const phase = seriesPhase(series, today);
  const live = liveOccurrences(series)[0];
  const chips: Chip[] = [];
  if (phase !== "active") chips.push(PHASE_CHIP[phase]);
  if (live) chips.push(...occurrenceChips(live, hidden));
  else if (series.occurrences.length > 0)
    chips.push({ tone: "neutral", label: "Pulada neste mês" });
  return {
    id: series.id,
    title: series.label,
    sub: [frequencyDescription(series), nextLabel(series), endLabel(series), cardBillLabel(series.card ?? null)]
      .filter(Boolean)
      .join(" · "),
    cents: live ? occurrenceCents(live) : series.expected_cents,
    chips,
  };
}

export type FrequentGroupModel = {
  id: string;
  title: string;
  sub: string;
  totalCents: string;
  chips: Chip[];
  occurrences: OverviewOccurrence[];
};

/** Série de várias vezes no mês: total do mês e as ocorrências para abrir uma a uma. */
export function frequentGroup(series: OverviewSeries, today: string): FrequentGroupModel {
  const phase = seriesPhase(series, today);
  return {
    id: series.id,
    title: series.label,
    sub: `${frequencyDescription(series)} · ${liveOccurrences(series).length} neste mês`,
    totalCents: series.month_cents,
    chips: phase === "active" ? [] : [PHASE_CHIP[phase]],
    occurrences: series.occurrences,
  };
}

export type SummaryModel = { eyebrow: string; totalCents: string; caption: string };

export function summary(overview: Pick<Overview, "total_cents" | "active">, month: string): SummaryModel {
  return {
    eyebrow: `Total das contas fixas em ${monthName(`${month}-01`)}`,
    totalCents: overview.total_cents,
    caption: activeCaption(overview.active),
  };
}

export function isEmptyOverview(overview: Overview): boolean {
  return (
    overview.series.length === 0 &&
    overview.suggestions.length === 0 &&
    overview.legacy.length === 0
  );
}

/** Contas do Mês que aceitam as ações da fatia 2: só as que pertencem a uma série. */
export function seriesItemById(items: MonthItem[], itemId: string): SeriesItem | null {
  const item = items.find((i) => i.id === itemId);
  return item && isSeriesBill(item) ? item : null;
}

/** Só mexe numa ocorrência que o Mês também conhece e que não foi pulada. */
export function isEditable(
  o: Pick<OverviewOccurrence, "item_id" | "archived">,
  editable: ReadonlySet<string>,
): boolean {
  return !o.archived && editable.has(o.item_id);
}

export function editableItemIds(items: MonthItem[]): ReadonlySet<string> {
  return new Set(items.filter((i) => isSeriesBill(i)).map((i) => i.id));
}
