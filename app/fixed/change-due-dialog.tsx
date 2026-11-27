"use client";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { brDate } from "../../src/domain/format.ts";
import { monthTitle } from "../lib/dates.ts";
import { monthName } from "./fixed-actions-model.ts";
import {
  dueChangedNotice,
  dueError,
  dueReady,
  monthBounds,
} from "./fixed-move-model.ts";
import type { SeriesItem } from "./fixed-status.ts";

/** "Mudar o vencimento": o dia fica sempre dentro do mês da conta; mudar de mês é outra ação. */
export function ChangeDueDialog({
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
  const month = item.month.slice(0, 7);
  const [due, setDue] = useState(item.due_date ?? "");
  const bounds = monthBounds(month);
  const problem = dueError(due, month);
  const ready = dueReady(due, month);

  return (
    <FamilyDialog
      open
      title="Mudar o vencimento"
      busy={action.busy}
      error={action.error}
      onClose={onBack}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          void action.work(async () => {
            await api("recurrences/due", {
              item_id: item.id,
              version: item.version,
              due_date: due,
            });
            onDone(dueChangedNotice(due));
          });
        }}
      >
        <p className="ds-caption">
          {item.label} de {monthName(item.month)}.{" "}
          {item.due_date ? `Hoje vence em ${brDate(item.due_date)}.` : "Hoje não tem vencimento."}
        </p>
        <label>
          Novo vencimento
          <input
            type="date"
            name="due"
            value={due}
            min={bounds.first}
            max={bounds.last}
            aria-invalid={problem !== null}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <p className="ds-caption">
          O vencimento fica sempre dentro de {monthTitle(month)}.
        </p>
        {problem && (
          <p className="rounded-xl border border-danger/25 bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={action.busy || !ready}
          >
            Salvar vencimento
          </Button>
          <Button variant="quiet" disabled={action.busy} onClick={onBack}>
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
