"use client";
import { CategoryPicker } from "../family-categories";
import { FieldError } from "./field-error";
import type { FixedFormErrors, FixedFormValues } from "./fixed-form-model.ts";

/** Valor, início e categoria; valor e categoria podem ficar de fora (conversão de item). */
export function AmountStartFields({
  initial,
  errors,
  idPrefix,
  minDate,
  categories,
  withAmount = true,
  withCategory = true,
  dateLabel = "Começa em",
  dateHint,
}: {
  initial: FixedFormValues;
  errors: FixedFormErrors;
  idPrefix: string;
  minDate: string;
  categories: { id: string; name: string; fixed?: boolean }[];
  withAmount?: boolean;
  withCategory?: boolean;
  dateLabel?: string;
  dateHint?: string;
}) {
  return (
    <>
      {withAmount && (
        <>
          <label>
            Valor esperado
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={initial.amount}
              aria-describedby={`${idPrefix}-error-amount`}
            />
          </label>
          <FieldError id={`${idPrefix}-error-amount`} text={errors.amount} />
        </>
      )}
      <label>
        {dateLabel}
        <input
          name="start_date"
          type="date"
          min={minDate || undefined}
          defaultValue={initial.startDate}
          aria-describedby={`${idPrefix}-error-start${dateHint ? ` ${idPrefix}-hint-start` : ""}`}
        />
      </label>
      {dateHint && (
        <p id={`${idPrefix}-hint-start`} className="ds-caption">
          {dateHint}
        </p>
      )}
      <FieldError id={`${idPrefix}-error-start`} text={errors.startDate} />
      {withCategory && (
        <CategoryPicker categories={categories} value={initial.categoryId} />
      )}
    </>
  );
}
