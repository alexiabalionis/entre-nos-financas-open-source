"use client";
import { Button } from "../../ds/index.ts";
import { FamilyDialog } from "../../dialogs/family-dialog.tsx";
import {
  deleteMessage,
  type CategoryTag,
  type SpaceCategory,
} from "./categories-model.ts";

export type DeleteTarget = { category: SpaceCategory; tag: CategoryTag } | null;

/** Confirmação de excluir etiqueta que já está em movimentos. */
export function DeleteTagDialog({
  target,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  target: DeleteTarget;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog
      open={target !== null}
      title={target ? `Excluir a etiqueta ${target.tag.name}?` : ""}
      busy={busy}
      error={error}
      onClose={onClose}
    >
      {target && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onConfirm();
          }}
        >
          <p>{deleteMessage(target.category, target.tag)}</p>
          <div className="family-actions">
            <Button onClick={onClose} disabled={busy}>
              Manter etiqueta
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              Excluir etiqueta
            </Button>
          </div>
        </form>
      )}
    </FamilyDialog>
  );
}
