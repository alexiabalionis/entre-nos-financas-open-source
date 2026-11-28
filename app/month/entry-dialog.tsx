"use client";
import { Button } from "../ds/button.tsx";
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
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink">
          O dinheiro já entrou ou ainda está previsto?
        </p>
        <Button variant="primary" className="w-full" onClick={onRecord}>
          Já recebi · registrar entrada
        </Button>
        <Button variant="quiet" className="w-full" onClick={onPlan}>
          Vou receber · planejar entrada
        </Button>
        <p className="ds-caption">
          Se a entrada já existe no extrato ou no plano, atualize o item
          existente para evitar duplicar.
        </p>
      </div>
    </FamilyDialog>
  );
}
