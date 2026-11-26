"use client";
import { Select } from "../ds/select";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { monthTitle } from "../lib/dates.ts";
import type { SeriesItem } from "./fixed-status.ts";
import {
  asksDue,
  dueError,
  monthBounds,
  moveHint,
  movePayload,
  movedNotice,
  moveReady,
  moveTargets,
  type DueMode,
} from "./fixed-move-model.ts";
import { monthName } from "./fixed-actions-model.ts";

/** "Mudar o mês em que conta": o vencimento no mês novo é escolha da pessoa, nunca calculado. */
export function MoveMonthDialog({
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
  const targets = moveTargets(item.month);
  const [month, setMonth] = useState(targets[0].value);
  const [dueMode, setDueMode] = useState<DueMode>("pick");
  const [due, setDue] = useState("");
  const form = { month, dueMode, due };
  const problem = dueError(due, month);
  const hint = moveHint(form, item);
  const bounds = monthBounds(month);

  return (
    <FamilyDialog
      open
      title="Mudar o mês em que conta"
      busy={action.busy}
      error={action.error}
      onClose={onBack}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!moveReady(form, item)) return;
          void action.work(async () => {
            await api("recurrences/move", movePayload(item, form));
            onDone(movedNotice(item.label, month));
          });
        }}
      >
        <p className="ds-caption">
          {item.label} hoje conta em {monthName(item.month)}. Só muda o mês em
          que ela conta. A data da compra ou do pagamento não é alterada.
        </p>
        <label>
          Passa a contar em
          <Select
            name="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setDue("");
            }}
          >
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        {asksDue(item) && (
          <>
            <p>
              <strong>E o vencimento?</strong>
            </p>
            <p className="ds-caption">Você escolhe. Não trocamos o dia por conta própria.</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Vencimento no novo mês">
              <Button
                variant={dueMode === "pick" ? "primary" : "quiet"}
                aria-pressed={dueMode === "pick"}
                onClick={() => setDueMode("pick")}
              >
                Escolher um dia
              </Button>
              <Button
                variant={dueMode === "none" ? "primary" : "quiet"}
                aria-pressed={dueMode === "none"}
                onClick={() => setDueMode("none")}
              >
                Sem vencimento
              </Button>
            </div>
            {dueMode === "pick" && (
              <label>
                Vencimento em {monthTitle(month)}
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
            )}
            {problem && (
              <p className="alert alert-soft alert-error" role="alert">
                {problem}
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={action.busy || !moveReady(form, item)}
          >
            Mudar o mês
          </Button>
          <Button variant="quiet" disabled={action.busy} onClick={onBack}>
            Voltar
          </Button>
        </div>
        {hint && <p className="ds-caption">{hint}</p>}
      </form>
    </FamilyDialog>
  );
}
