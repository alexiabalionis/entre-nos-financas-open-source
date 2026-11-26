"use client";
import { FamilyDialog } from "../dialogs/family-dialog";
import { useAction } from "../hooks/use-action.ts";
import { FixedFormBody } from "./fixed-form-body";
import { FixedPendingNotice } from "./fixed-pending-notice";
import type { FixedOrigin } from "./fixed-form-model.ts";
import type { FixedNotice, RowAction } from "./fixed-row-model.ts";

/** "Virar conta fixa" a partir de um movimento: formulário ou aviso de pendente. */
export function FixedFromMovementDialog({
  open,
  mode,
  origin,
  categories,
  onClose,
  onApprove,
  onCreated,
  refresh,
}: {
  open: boolean;
  mode: RowAction;
  origin: FixedOrigin;
  categories: { id: string; name: string; fixed?: boolean }[];
  onClose: () => void;
  onApprove: () => void;
  onCreated: (notice: FixedNotice) => void;
  refresh: () => Promise<void>;
}) {
  const action = useAction();
  const pending = mode === "pending" || mode === "confirming";
  return (
    <FamilyDialog
      open={open}
      title={pending ? "Ainda não dá para virar conta fixa" : "Virar conta fixa"}
      busy={action.busy}
      error={action.error}
      onClose={onClose}
    >
      {pending ? (
        <FixedPendingNotice
          description={origin.title}
          confirming={mode === "confirming"}
          onApprove={() => {
            onClose();
            onApprove();
          }}
          onClose={onClose}
        />
      ) : (
        <FixedFormBody
          origin={origin}
          categories={categories}
          action={action}
          onCreated={onCreated}
          onClose={onClose}
          refresh={refresh}
        />
      )}
    </FamilyDialog>
  );
}
