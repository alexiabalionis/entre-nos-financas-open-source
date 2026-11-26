"use client";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import { removeBody } from "./budget-form-model.ts";
import type { BudgetCardModel, Money } from "./budget-view-model.ts";

/** Confirmação de "Tirar o teto": explica o que muda e o que fica. */
export function BudgetRemoveDialog({
  card,
  name,
  from,
  month,
  fmt,
  busy,
  error,
  onConfirm,
  onBack,
}: {
  card: BudgetCardModel;
  name: string;
  from: string;
  month: string;
  fmt: Money;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <FamilyDialog
      open
      title={`Tirar o teto de ${name}?`}
      busy={busy}
      error={error}
      onClose={onBack}
    >
      <p>{removeBody(name, fmt(card.ceiling), from, month)}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          Tirar o teto
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>
          Voltar
        </Button>
      </div>
    </FamilyDialog>
  );
}
