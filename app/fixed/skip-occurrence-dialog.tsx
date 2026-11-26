"use client";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { monthName, skipDone } from "./fixed-actions-model.ts";
import type { SeriesItem } from "./fixed-status.ts";

/** "Pular esta": a conta sai do plano naquele mês e a série não a recria. */
export function SkipOccurrenceDialog({
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
  const name = monthName(item.month);
  return (
    <FamilyDialog
      open
      title="Pular esta?"
      busy={action.busy}
      error={action.error}
      onClose={onBack}
    >
      <p>
        {item.label} de {name} sai do plano e não volta. Os meses seguintes
        continuam normais.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.work(async () => {
              await api("recurrences/cancel", {
                item_id: item.id,
                version: item.version,
              });
              onDone(skipDone(item.label, item.month));
            })
          }
        >
          Pular {item.label} de {name}
        </Button>
        <Button variant="quiet" disabled={action.busy} onClick={onBack}>
          Voltar
        </Button>
      </div>
    </FamilyDialog>
  );
}
