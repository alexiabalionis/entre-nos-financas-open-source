"use client";
import { Button } from "../ds/button.tsx";
import { FamilyDialog } from "../dialogs/family-dialog.tsx";
import { Field } from "../field.tsx";
import type { GoalDraft } from "./use-goal-form.ts";

export function GoalFormDialog({
  open,
  isNew,
  draft,
  showErrors,
  nameError,
  amountError,
  busy,
  error,
  onEdit,
  onSave,
  onClose,
}: {
  open: boolean;
  isNew: boolean;
  draft: GoalDraft;
  showErrors: boolean;
  nameError: string;
  amountError: string;
  busy: boolean;
  error: string;
  onEdit: (patch: Partial<GoalDraft>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog
      open={open}
      title={isNew ? "Nova reserva" : "Editar reserva"}
      busy={busy}
      error={error}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <Field label="Nome" error={showErrors ? nameError : undefined}>
          <input
            name="name"
            autoComplete="off"
            value={draft.name}
            aria-invalid={(showErrors && !!nameError) || undefined}
            onChange={(e) => onEdit({ name: e.target.value })}
          />
        </Field>
        <Field label="Meta" error={showErrors ? amountError : undefined}>
          <input
            name="target"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Ex.: 3.000,00"
            value={draft.target}
            aria-invalid={(showErrors && !!amountError) || undefined}
            onChange={(e) => onEdit({ target: e.target.value })}
          />
        </Field>
        <Field label="Prazo (opcional)">
          <input
            type="month"
            name="deadline"
            value={draft.deadline}
            onChange={(e) => onEdit({ deadline: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" type="submit" disabled={busy}>
            Salvar
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
