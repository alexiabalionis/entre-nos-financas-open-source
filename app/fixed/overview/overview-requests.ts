import { fixedPayload, ruleParts, type FixedFormValues } from "../fixed-form-model.ts";
import { movePayload } from "../fixed-move-model.ts";
import {
  convertedNotice,
  dismissedNotice,
  suggestionCreatedNotice,
} from "./overview-copy.ts";
import { formMode, validateSeriesForm } from "./overview-form-model.ts";
import type {
  FormTarget,
  OverviewReview,
  OverviewSuggestion,
} from "./overview-types.ts";

export type FormRequest = { route: string; body: Record<string, unknown> };

/** Rota e corpo prontos para gravar, ou null enquanto o formulário tem erro. */
export function formRequest(
  target: FormTarget,
  values: FixedFormValues,
  minDate: string,
): FormRequest | null {
  const mode = formMode(target);
  if (Object.keys(validateSeriesForm(mode, values, minDate)).length) return null;
  const rule = ruleParts(values);
  if (!rule) return null;
  if (target.kind === "legacy")
    return {
      route: "recurrences/convert",
      body: {
        item_id: target.legacy.item_id,
        version: target.legacy.version,
        frequency: rule.frequency,
        every: rule.every,
        start_date: values.startDate,
      },
    };
  const base = fixedPayload(values, { date: minDate, eventId: "" });
  if (!base) return null;
  const s = target.suggestion;
  return {
    route: "recurrences/create",
    body: {
      purpose: "expense",
      label: base.label,
      expected_cents: base.expected_cents,
      category_id: base.category_id ?? null,
      account_id: s.account_id,
      frequency: base.frequency,
      every: base.every,
      start_date: base.start_date,
      match_text: s.merchant_key,
      ...(base.since_month ? { since_month: base.since_month } : {}),
      ...(base.end_date ? { end_date: base.end_date } : {}),
    },
  };
}

export function doneNotice(target: FormTarget): string {
  return target.kind === "suggestion"
    ? suggestionCreatedNotice(target.suggestion.label)
    : convertedNotice(target.legacy.label);
}

export function dismissRequest(s: OverviewSuggestion): FormRequest {
  return {
    route: "recurrences/decision",
    body: { scope: s.scope, merchant_key: s.merchant_key, decision: "dismiss" },
  };
}

export function dismissDone(s: OverviewSuggestion): string {
  return dismissedNotice(s.label);
}

/** Mover a previsão do cartão para o mês certo; sem vencimento sugerido, o vencimento sai. */
export function reviewRequest(review: OverviewReview): FormRequest {
  return {
    route: "recurrences/move",
    body: movePayload(
      {
        id: review.item_id,
        version: review.version,
        month: review.current_month,
        due_date: review.suggested_due_date,
      },
      {
        month: review.suggested_month,
        dueMode: "pick",
        due: review.suggested_due_date ?? "",
      },
    ),
  };
}
