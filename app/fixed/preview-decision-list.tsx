"use client";
import { Button } from "../button";
import { Callout } from "../ds/callout";
import {
  entryMonth,
  type Choice,
  type Decisions,
  type PreviewEntry,
} from "./preview-model.ts";

/** Uma decisão por ocorrência editada à mão: nada muda nela sem a escolha da pessoa. */
export function PreviewDecisionList({
  entries,
  decisions,
  labels,
  onDecide,
}: {
  entries: PreviewEntry[];
  decisions: Decisions;
  labels: Record<Choice, string>;
  onDecide: (itemId: string, choice: Choice) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const chosen = decisions[entry.monthly_item_id];
        const month = entryMonth(entry);
        return (
          <Callout
            key={entry.monthly_item_id}
            tone={chosen ? "ok" : "warn"}
            icon={chosen ? "✓" : "!"}
            title={month}
            details={
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={`Decisão para ${month}`}
              >
                {(["keep", "replace"] as const).map((choice) => (
                  <Button
                    key={choice}
                    variant={chosen === choice ? "primary" : "quiet"}
                    aria-pressed={chosen === choice}
                    onClick={() => onDecide(entry.monthly_item_id, choice)}
                  >
                    {labels[choice]}
                  </Button>
                ))}
              </div>
            }
          >
            {chosen ? "Decidido." : "Você mudou esta conta à mão."}
          </Callout>
        );
      })}
    </>
  );
}
