"use client";
import { FieldError } from "./field-error";
import type { FixedFormErrors, FixedFormValues } from "./fixed-form-model.ts";

/** "Desde" (mês, opcional) e "Até" (data, opcional) de uma conta fixa. */
export function PeriodFields({
  initial,
  errors,
  idPrefix,
  withSince = true,
}: {
  initial: FixedFormValues;
  errors: FixedFormErrors;
  idPrefix: string;
  withSince?: boolean;
}) {
  return (
    <>
      {withSince && (
        <>
      <label>
        Já era fixa desde (opcional)
        <input
          name="since_month"
          type="month"
          defaultValue={initial.since ?? ""}
          aria-describedby={`${idPrefix}-hint-since ${idPrefix}-error-since`}
        />
      </label>
      <p className="ds-caption" id={`${idPrefix}-hint-since`}>
        Os meses antes do início entram como pagos, com o mesmo valor. Se houver um pagamento parecido no mês, ele fica ligado à conta.
      </p>
      <FieldError id={`${idPrefix}-error-since`} text={errors.since} />
        </>
      )}
      <label>
        Termina em (opcional)
        <input
          name="end_date"
          type="date"
          defaultValue={initial.endDate ?? ""}
          aria-describedby={`${idPrefix}-error-end`}
        />
      </label>
      <FieldError id={`${idPrefix}-error-end`} text={errors.endDate} />
    </>
  );
}
