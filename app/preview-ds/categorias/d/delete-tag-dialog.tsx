"use client";
import { Button } from "../../../ds/index.ts";
import { FamilyDialog } from "../../../dialogs/family-dialog.tsx";
import { deleteMessage, type Category, type Tag } from "../fixture.ts";

export type DeleteTarget = { category: Category; tag: Tag } | null;

/** Confirmação de excluir etiqueta que já está em movimentos. */
export function DeleteTagDialog({
  target,
  onConfirm,
  onClose,
}: {
  target: DeleteTarget;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog
      open={target !== null}
      title={target ? `Excluir a etiqueta ${target.tag.name}?` : ""}
      busy={false}
      error=""
      onClose={onClose}
    >
      {target && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <p>{deleteMessage(target.category, target.tag)}</p>
          <div className="family-actions">
            <Button onClick={onClose}>Manter etiqueta</Button>
            <Button type="submit" variant="primary">
              Excluir etiqueta
            </Button>
          </div>
        </form>
      )}
    </FamilyDialog>
  );
}
