import type { readFixedOverview } from "../../../src/server/recurrence-overview.ts";
import type { Tone } from "../../ds/shared.ts";

export type Overview = Awaited<ReturnType<typeof readFixedOverview>>;
export type OverviewSeries = Overview["series"][number];
export type OverviewOccurrence = OverviewSeries["occurrences"][number];
export type OverviewSuggestion = Overview["suggestions"][number];
export type OverviewLegacy = Overview["legacy"][number];
export type OverviewReview = Overview["card_cycle_review"][number];

/** O que o formulário "Criar conta fixa" está transformando em série. */
export type FormTarget =
  | { kind: "suggestion"; suggestion: OverviewSuggestion }
  | { kind: "legacy"; legacy: OverviewLegacy };

export type Chip = { tone: Tone; label: string; icon?: string };
