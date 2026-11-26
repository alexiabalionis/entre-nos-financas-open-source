"use client";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import type { Data } from "../hooks/use-month-data.ts";
import { AmountStartFields } from "./amount-start-fields";
import { FieldError } from "./field-error";
import { nextText } from "./fixed-form-model.ts";
import { valuesFromForm } from "./fixed-row-model.ts";
import type { SeriesItem } from "./fixed-status.ts";
import { FrequencyFields } from "./frequency-fields";
import { PeriodFields } from "./period-fields";
import { editFrom, seriesChanges, seriesEditErrors, seriesEditValues } from "./series-edit-model.ts";
import { SeriesPreviewDialog } from "./series-preview-dialog";
import { cardDateHint } from "./series-edit-model.ts";

/**
 * "Editar conta fixa": nome, valor, categoria, frequência, data e fim, valendo
 * desta conta em diante. Depois do formulário vem a mesma prévia de "Esta e as
 * próximas", que pede decisão para cada mês ajustado à mão.
 */
export function SeriesEditDialog({
  item,
  categories,
  hidden,
  action,
  onBack,
  onDone,
}: {
  item: SeriesItem;
  categories: Data["state"]["categories"];
  hidden: boolean;
  action: Action;
  onBack: () => void;
  onDone: (message: string) => void;
}) {
  const from = item.recurrence.occurrence_date;
  const card = item.recurrence.card_name;
  const initial = seriesEditValues(item);
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const [changes, setChanges] = useState<Record<string, unknown> | null>(null);
  const errors = tried ? seriesEditErrors(values, from) : {};

  if (changes)
    return (
      <SeriesPreviewDialog
        mode="next"
        item={item}
        hidden={hidden}
        action={action}
        changes={changes}
        from={editFrom(changes, from)}
        onBack={() => setChanges(null)}
        onDone={onDone}
      />
    );

  return (
    <FamilyDialog open title="Editar conta fixa" busy={action.busy} error={action.error} onClose={onBack}>
      <form
        noValidate
        onChange={(e) => setValues(valuesFromForm(Object.fromEntries(new FormData(e.currentTarget))))}
        onSubmit={(e) => {
          e.preventDefault();
          const current = valuesFromForm(Object.fromEntries(new FormData(e.currentTarget)));
          setValues(current);
          setTried(true);
          const next = seriesChanges(current, from);
          if (next) setChanges(next);
        }}
      >
        <p className="ds-caption">
          As mudanças valem desta conta em diante. Para voltar a data, escolha um dia antes: as contas abertas a partir dele são trocadas e as pagas ficam como estão. Para mudar só o valor dos meses anteriores, use &quot;Todas&quot;.
        </p>
        <label>
          Nome
          <input name="label" defaultValue={initial.label} maxLength={180} autoComplete="off" aria-describedby="edit-error-label" />
        </label>
        <FieldError id="edit-error-label" text={errors.label} />
        <FrequencyFields initial={initial} current={values} errors={errors} idPrefix="edit" />
        <AmountStartFields
          initial={initial}
          errors={errors}
          idPrefix="edit"
          minDate=""
          categories={categories}
          {...(card ? { dateLabel: "Dia da cobrança no cartão", dateHint: cardDateHint(card, item.due_date) } : {})}
        />
        <PeriodFields initial={initial} errors={errors} idPrefix="edit" withSince={false} />
        {nextText(values, { date: from }) && (
          <p className="ds-caption" role="status">
            Depois desta: {nextText(values, { date: from })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Ver o que muda
          </Button>
          <Button variant="quiet" disabled={action.busy} onClick={onBack}>
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
