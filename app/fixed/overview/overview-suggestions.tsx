"use client";
import { Button } from "../../ds/button";
import { StatusChip } from "../../ds/status-chip";
import { money } from "../../lib/money.ts";
import { monthsText } from "./overview-copy.ts";
import { OverviewItemRow } from "./overview-item-row";
import type { OverviewSuggestion } from "./overview-types.ts";

/** Gastos que se repetem no mesmo dia: criar a conta fixa ou dizer que não é. */
export function OverviewSuggestions({
  suggestions,
  hidden,
  busy,
  onCreate,
  onDismiss,
}: {
  suggestions: OverviewSuggestion[];
  hidden: boolean;
  busy: boolean;
  /** Sem os dois botões, a pessoa só acompanha. */
  onCreate: ((s: OverviewSuggestion) => void) | null;
  onDismiss: ((s: OverviewSuggestion) => void) | null;
}) {
  return (
    <>
      {suggestions.map((s) => (
        <OverviewItemRow
          key={`${s.scope}:${s.merchant_key}`}
          title={s.label}
          sub={`${money(s.cents, "BRL", hidden)} · costuma cair no dia ${s.day} · ${monthsText(s.months)}`}
          chips={
            s.previously_confirmed && (
              <StatusChip
                tone="accent"
                icon="↻"
                label="Você já tinha marcado"
              />
            )
          }
        >
          {onCreate && onDismiss && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                icon="plus"
                disabled={busy}
                onClick={() => onCreate(s)}
              >
                Criar conta fixa
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => onDismiss(s)}
              >
                Não é fixa
              </Button>
            </div>
          )}
        </OverviewItemRow>
      ))}
    </>
  );
}
