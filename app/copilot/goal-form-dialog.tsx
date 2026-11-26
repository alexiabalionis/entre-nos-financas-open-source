"use client";
// Diálogo de nova reserva ou edição (nome, meta, prazo). Prioridade e status
// mudam por outros fluxos — este formulário só cuida desses três campos.
import { Button } from "../button.tsx";
import { FamilyDialog } from "../dialogs/family-dialog.tsx";
import { FieldError } from "../fixed/field-error.tsx";
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
        className="cop-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <label>
          Nome
          <input
            name="name"
            autoComplete="off"
            value={draft.name}
            aria-invalid={(showErrors && !!nameError) || undefined}
            aria-describedby="goal-name-error"
            onChange={(e) => onEdit({ name: e.target.value })}
          />
        </label>
        <FieldError id="goal-name-error" text={showErrors ? nameError : undefined} />
        <label>
          Meta
          <input
            name="target"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Ex.: 3.000,00"
            value={draft.target}
            aria-invalid={(showErrors && !!amountError) || undefined}
            aria-describedby="goal-target-error"
            onChange={(e) => onEdit({ target: e.target.value })}
          />
        </label>
        <FieldError id="goal-target-error" text={showErrors ? amountError : undefined} />
        <label>
          Prazo (opcional)
          <input
            type="month"
            name="deadline"
            value={draft.deadline}
            onChange={(e) => onEdit({ deadline: e.target.value })}
          />
        </label>
        <div className="cop-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            Salvar
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
