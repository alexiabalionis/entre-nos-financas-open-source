"use client";
import { AmountStartFields } from "./amount-start-fields";
import { FieldError } from "./field-error";
import type { FixedFormErrors, FixedFormValues } from "./fixed-form-model.ts";
import { FrequencyFields } from "./frequency-fields";
import { PeriodFields } from "./period-fields";

type FieldsProps = {
  initial: FixedFormValues;
  current: FixedFormValues;
  errors: FixedFormErrors;
  categories: { id: string; name: string; fixed?: boolean }[];
  account: string;
  next: string;
  startsAtOrigin: boolean;
  originDate: string;
};

/** Campos do formulário "Virar conta fixa"; os valores vivos vêm do pai. */
export function FixedFormFields({
  initial,
  current,
  errors,
  categories,
  account,
  next,
  startsAtOrigin,
  originDate,
}: FieldsProps) {
  return (
    <>
      <label>
        Nome
        <input
          name="label"
          defaultValue={initial.label}
          maxLength={180}
          autoComplete="off"
          aria-describedby="fixed-error-label"
        />
      </label>
      <FieldError id="fixed-error-label" text={errors.label} />
      <FrequencyFields
        initial={initial}
        current={current}
        errors={errors}
        idPrefix="fixed"
      />
      <AmountStartFields
        initial={initial}
        errors={errors}
        idPrefix="fixed"
        minDate={originDate}
        categories={categories}
      />
      <PeriodFields initial={initial} errors={errors} idPrefix="fixed" />
      <p className="ds-caption">Conta: {account}. A conta e a categoria vieram do movimento.</p>
      {next && (
        <p className="ds-caption" role="status">
          Próximas: {next}
        </p>
      )}
      <p className="ds-caption">
        {startsAtOrigin
          ? "Esta transação já conta como a primeira."
          : "Esta transação continua como está e não entra como a primeira."}
      </p>
    </>
  );
}
