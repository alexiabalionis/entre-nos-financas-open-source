"use client";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";

/** "Adicionar entrada": escolhe entre registrar o que entrou ou planejar o que vem. */
export function EntryDialog({
  open,
  action,
  onClose,
  onRecord,
  onPlan,
}: {
  open: boolean;
  action: Action;
  onClose: () => void;
  onRecord: () => void;
  onPlan: () => void;
}) {
  return (
    <FamilyDialog
      open={open}
      title="Adicionar entrada"
      busy={action.busy}
      error={action.error}
      onClose={onClose}
    >
      <div className="family-entry-options">
        <p>O dinheiro já entrou ou ainda está previsto?</p>
        <button className="primary btn btn-primary" onClick={onRecord}>
          Já recebi · registrar entrada
        </button>
        <button className="btn btn-soft" onClick={onPlan}>Vou receber · planejar entrada</button>
        <p className="ds-caption">
          Se a entrada já existe no extrato ou no plano, atualize o item
          existente para evitar duplicar.
        </p>
      </div>
    </FamilyDialog>
  );
}
