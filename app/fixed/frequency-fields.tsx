"use client";
import { Select } from "../ds/select";
import { FieldError } from "./field-error";
import type { FixedFormErrors, FixedFormValues } from "./fixed-form-model.ts";

/** Frequência da conta fixa; "A cada quanto?" só aparece em "custom". */
export function FrequencyFields({
  initial,
  current,
  errors,
  idPrefix,
}: {
  initial: FixedFormValues;
  current: FixedFormValues;
  errors: FixedFormErrors;
  idPrefix: string;
}) {
  return (
    <>
      <label>
        Com que frequência?
        <Select name="frequency" defaultValue={initial.frequency}>
          <option value="month">Todo mês</option>
          <option value="week">Toda semana</option>
          <option value="custom">A cada alguns dias, semanas ou meses</option>
          <option value="year">Todo ano</option>
        </Select>
      </label>
      {current.frequency === "custom" && (
        <>
          <label>
            A cada quanto?
            <input
              name="every"
              type="number"
              inputMode="numeric"
              min={1}
              max={366}
              defaultValue={initial.every}
              aria-describedby={`${idPrefix}-error-every`}
            />
          </label>
          <label>
            Unidade
            <Select name="unit" defaultValue={initial.unit}>
              <option value="day">dias</option>
              <option value="week">semanas</option>
              <option value="month">meses</option>
            </Select>
          </label>
          <FieldError id={`${idPrefix}-error-every`} text={errors.every} />
        </>
      )}
    </>
  );
}
