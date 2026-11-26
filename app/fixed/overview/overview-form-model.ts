import { brDate, plainMoney } from "../../../src/domain/format.ts";
import { moveMonth } from "../../lib/dates.ts";
import { money } from "../../lib/money.ts";
import {
  validateFixed,
  type FixedFormErrors,
  type FixedFormValues,
} from "../fixed-form-model.ts";
import { monthBounds } from "../fixed-move-model.ts";
import type { FormTarget, OverviewLegacy } from "./overview-types.ts";

export type FormMode = "create" | "convert";

export type FormDefaults = {
  mode: FormMode;
  values: FixedFormValues;
  minDate: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELEVANT: Record<FormMode, ReadonlySet<string>> = {
  create: new Set(["label", "amount", "every", "startDate", "since", "endDate"]),
  convert: new Set(["every", "startDate"]),
};

export function formMode(target: FormTarget): FormMode {
  return target.kind === "suggestion" ? "create" : "convert";
}

function absolute(cents: string): string {
  const n = BigInt(cents);
  return (n < 0n ? -n : n).toString();
}

/** Próximo dia `day` do mês a partir de hoje (hoje conta), respeitando meses curtos. */
export function suggestionStartDate(day: number, today: string): string {
  const pick = (month: string) => {
    const last = Number(monthBounds(month).last.slice(8));
    return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const month = today.slice(0, 7);
  const thisMonth = pick(month);
  return thisMonth >= today ? thisMonth : pick(moveMonth(month, 1));
}

function baseValues(label: string, categoryId: string | null): FixedFormValues {
  return {
    label: label.slice(0, 180),
    frequency: "month",
    every: "2",
    unit: "month",
    amount: "",
    startDate: "",
    categoryId: categoryId ?? "",
  };
}

/** Valores iniciais e a data mínima de início de cada tipo de formulário. */
export function formDefaults(
  target: FormTarget,
  today: string,
  month: string,
): FormDefaults {
  if (target.kind === "suggestion") {
    const s = target.suggestion;
    return {
      mode: "create",
      minDate: today,
      values: {
        ...baseValues(s.label, s.category_id),
        amount: plainMoney(absolute(s.cents)),
        startDate: suggestionStartDate(s.day, today),
      },
    };
  }
  const l = target.legacy;
  const startDate = l.due_date ?? `${month}-01`;
  return {
    mode: "convert",
    minDate: startDate,
    values: {
      ...baseValues(l.label, l.category_id),
      amount: l.planned_cents === null ? "" : plainMoney(l.planned_cents),
      startDate,
    },
  };
}

/** Na conversão só frequência e início mudam; o resto vem do item antigo e fica como está. */
export function mergeFormValues(
  mode: FormMode,
  base: FixedFormValues,
  edited: FixedFormValues,
): FixedFormValues {
  if (mode === "create") return edited;
  const { frequency, every, unit, startDate } = edited;
  return { ...base, frequency, every, unit, startDate };
}

export function validateSeriesForm(
  mode: FormMode,
  values: FixedFormValues,
  minDate: string,
): FixedFormErrors {
  const all = validateFixed(values, { date: minDate });
  const errors: FixedFormErrors = Object.fromEntries(
    Object.entries(all).filter(([key]) => RELEVANT[mode].has(key)),
  );
  if (errors.startDate && ISO_DATE.test(values.startDate) && values.startDate < minDate)
    errors.startDate = `Escolha uma data a partir de ${brDate(minDate)}.`;
  return errors;
}

export const FORM_TITLE: Record<FormMode, string> = {
  create: "Criar conta fixa",
  convert: "Transformar em conta fixa",
};

/** Quem está sendo transformado, em uma linha, no alto do formulário. */
export function targetContext(
  target: FormTarget,
  hidden: boolean,
): { title: string; sub: string } {
  if (target.kind === "legacy")
    return { title: target.legacy.label, sub: "Veio da lista antiga" };
  const s = target.suggestion;
  return {
    title: s.label,
    sub: `${money(s.cents, "BRL", hidden)} · costuma cair no dia ${s.day}`,
  };
}

export function canConvert(legacy: OverviewLegacy): boolean {
  return legacy.planned_cents !== null && BigInt(legacy.planned_cents) > 0n;
}
