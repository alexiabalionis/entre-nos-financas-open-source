"use client";
import { useState, type FormEvent } from "react";
import { Button } from "../../button";
import { FamilyDialog } from "../../dialogs/family-dialog";
import { Row } from "../../ds/row";
import { useAction } from "../../hooks/use-action.ts";
import { api } from "../../lib/api.ts";
import { nextText } from "../fixed-form-model.ts";
import { valuesFromForm } from "../fixed-row-model.ts";
import {
  FORM_TITLE,
  formDefaults,
  mergeFormValues,
  targetContext,
  validateSeriesForm,
} from "./overview-form-model.ts";
import { doneNotice, formRequest } from "./overview-requests.ts";
import type { FormTarget } from "./overview-types.ts";
import { SeriesFormFields } from "./series-form-fields";

/** "Criar conta fixa" a partir de uma sugestão, ou "Transformar em conta fixa" a partir de um item antigo. */
export function SeriesFormDialog({
  target,
  today,
  month,
  hidden,
  categories,
  onDone,
  onClose,
}: {
  target: FormTarget;
  today: string;
  month: string;
  hidden: boolean;
  categories: { id: string; name: string; fixed?: boolean }[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const action = useAction();
  const [defaults] = useState(() => formDefaults(target, today, month));
  const [values, setValues] = useState(defaults.values);
  const [submitted, setSubmitted] = useState(false);
  const { mode, minDate } = defaults;
  const errors = submitted ? validateSeriesForm(mode, values, minDate) : {};
  const context = targetContext(target, hidden);

  const read = (form: HTMLFormElement) =>
    mergeFormValues(
      mode,
      defaults.values,
      valuesFromForm(Object.fromEntries(new FormData(form))),
    );

  const send = (current: typeof values) => {
    setSubmitted(true);
    const request = formRequest(target, current, minDate);
    if (!request) return;
    void action.work(async () => {
      await api(request.route, request.body);
      onDone(doneNotice(target));
      onClose();
    }, "");
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(read(e.currentTarget));
  };

  return (
    <FamilyDialog
      open
      title={FORM_TITLE[mode]}
      busy={action.busy}
      error={action.error}
      onClose={onClose}
    >
      <form
        onSubmit={onSubmit}
        onChange={(e) => setValues(read(e.currentTarget))}
        noValidate
      >
        <Row title={context.title} sub={context.sub} />
        <SeriesFormFields
          mode={mode}
          initial={defaults.values}
          current={values}
          errors={errors}
          categories={categories}
          minDate={minDate}
          next={nextText(values, { date: minDate })}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="quiet" onClick={onClose} disabled={action.busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={action.busy}>
            {FORM_TITLE[mode]}
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
