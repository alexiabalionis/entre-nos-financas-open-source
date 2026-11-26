"use client";
import { useState } from "react";
import { DiffList, DraftBar, Sheet } from "../ds/index.ts";
import { cx } from "../ds/shared.ts";
import { monthLong } from "../../src/domain/future-months.ts";
import { maskMoney } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";
import { diffRows, draftSummary } from "./view-model.ts";

/**
 * Barra de rascunho do Futuro: aparece com uma simulação não salva, abre o
 * "O que muda" (antes → depois) e descarta. Só oferece gravar quando pode
 * (não é modo leitura e há aporte ou pausa); a confirmação fica na própria barra.
 */
export function FutureDraftBar() {
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
        onSave={f.canSave ? () => void f.save() : undefined}
        saving={f.saving}
        confirmSave={
          start ? `Gravar o novo aporte a partir de ${monthLong(start)}? Os planos anteriores ficam no histórico.` : undefined
        }
      />
      <Sheet open={comparing && f.dirty} onClose={() => setComparing(false)} title="O que muda">
        <div className={cx("ds-reset", "fut-draft-compare")}>
          <DiffList rows={diffRows(f.diff, f.hidden)} />
          {f.describe.length > 0 ? (
            <ul className="fut-draft-describe" aria-label="Simulações aplicadas">
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
