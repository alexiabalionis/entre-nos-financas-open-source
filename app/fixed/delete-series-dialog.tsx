"use client";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import type { SeriesItem } from "./fixed-status.ts";

/** "Excluir conta fixa": some de todos os meses e da lista. Só sem contas pagas. */
export function DeleteSeriesDialog({
  item,
  action,
  onBack,
  onDone,
}: {
  item: SeriesItem;
  action: Action;
  onBack: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <FamilyDialog
      open
      title="Excluir conta fixa?"
      busy={action.busy}
      error={action.error}
      onClose={onBack}
    >
      <p>
        {item.label} deixa de ser prevista em todos os meses e sai da lista de
        contas fixas. Os movimentos do banco continuam como estão.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.work(async () => {
              await api("recurrences/delete", { recurrence_id: item.recurrence.id });
              onDone(`${item.label} foi excluída das contas fixas.`);
            })
          }
        >
          Excluir {item.label}
        </Button>
        <Button variant="quiet" disabled={action.busy} onClick={onBack}>
          Voltar
        </Button>
      </div>
    </FamilyDialog>
  );
}
