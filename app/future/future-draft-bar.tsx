"use client";
import { useState } from "react";
import { DiffList, DraftBar, Sheet } from "../ds/index.ts";
import { monthLong } from "../../src/domain/future-months.ts";
import { maskMoney } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";
import { diffRows, draftSummary } from "./view-model.ts";

export function FutureDraftBar({ onSaved }: { onSaved?: () => void }) {
  const f = useFutureContext();
  const [comparing, setComparing] = useState(false);
  const start = f.draftInput?.startMonth;
  return (
    <>
      <DraftBar
        open={f.dirty}
        summary={draftSummary(f.changes, f.describe, f.hidden)}
        onCompare={() => setComparing(true)}
        onDiscard={f.discard}
        onSave={
          f.canSave
            ? () =>
                void f.save().then((ok) => {
                  if (ok) onSaved?.();
                })
            : undefined
        }
        saving={f.saving}
        confirmSave={
          start
            ? `Gravar o novo aporte a partir de ${monthLong(start)}? Os planos anteriores ficam no histórico.`
            : undefined
        }
      />
      <Sheet
        open={comparing && f.dirty}
        onClose={() => setComparing(false)}
        title="O que muda"
      >
        <div className="flex flex-col gap-3">
          <DiffList rows={diffRows(f.diff, f.hidden)} />
          {f.describe.length > 0 ? (
            <ul
              className="m-0 list-disc space-y-1 pl-5 text-sm text-muted"
              aria-label="Simulações aplicadas"
            >
              {f.describe.map((line) => (
                <li key={line}>{maskMoney(line, f.hidden)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
