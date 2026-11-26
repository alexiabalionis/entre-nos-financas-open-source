"use client";
import { AmountStartFields } from "../amount-start-fields";
import { FieldError } from "../field-error";
import type { FixedFormErrors, FixedFormValues } from "../fixed-form-model.ts";
import { FrequencyFields } from "../frequency-fields";
import { PeriodFields } from "../period-fields";
import type { FormMode } from "./overview-form-model.ts";

/**
 * Campos de "Criar conta fixa" (sugestão) e "Transformar em conta fixa" (item
 * antigo). Na conversão só frequência e início: nome, valor e categoria vêm do
 * item e não mudam aqui.
 */
export function SeriesFormFields({
  mode,
  initial,
  current,
  errors,
  categories,
  minDate,
  next,
}: {
  mode: FormMode;
  initial: FixedFormValues;
  current: FixedFormValues;
  errors: FixedFormErrors;
  categories: { id: string; name: string; fixed?: boolean }[];
  minDate: string;
  next: string;
}) {
  return (
    <>
      {mode === "create" && (
        <>
          <label>
            Nome
            <input
              name="label"
              defaultValue={initial.label}
              maxLength={180}
              autoComplete="off"
              aria-describedby="overview-error-label"
            />
          </label>
          <FieldError id="overview-error-label" text={errors.label} />
        </>
      )}
      <FrequencyFields
        initial={initial}
        current={current}
        errors={errors}
        idPrefix="overview"
      />
      <AmountStartFields
        initial={initial}
        errors={errors}
        idPrefix="overview"
        minDate={minDate}
        categories={categories}
        withAmount={mode === "create"}
        withCategory={mode === "create"}
      />
      {mode === "create" && (
        <PeriodFields initial={initial} errors={errors} idPrefix="overview" />
      )}
      {next && (
        <p className="ds-caption" role="status">
          Próximas: {next}
        </p>
      )}
    </>
  );
}
