"use client";
import { Button } from "../button";
import type { ActionEntry, FixedAction } from "./fixed-actions-model.ts";

/** Uma linha por ação; a desabilitada continua visível e aponta para o motivo. */
export function FixedActionList({
  entries,
  reasonId,
  onChoose,
}: {
  entries: ActionEntry[];
  reasonId: string;
  onChoose: (action: FixedAction) => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-2">
      {entries.map((entry) => (
        <Button
          key={entry.id}
          disabled={!entry.enabled}
          aria-describedby={entry.enabled ? undefined : reasonId}
          onClick={() => onChoose(entry.id)}
          className="flex flex-col py-2"
        >
          <div className="flex flex-col py-2">

          <strong>{entry.title}</strong>

          <span className="text-xs font-light text-gray-500">{entry.hint}</span>
          </div>
        </Button>
      ))}
    </div>
  );
}
