"use client";
import { useState } from "react";
import { movementTitle, type Movement } from "../../src/domain/movements.ts";
import type { AdjustDraft } from "../../src/domain/movement-kind.ts";
import { FixedRowAction } from "../fixed/fixed-row-action";
import { rowAction } from "../fixed/fixed-row-model.ts";
import { ChangeKindDialog, type KindChoices } from "./change-kind-dialog";
import { RejectMovementDialog } from "./reject-movement-dialog";
import { api } from "../lib/api";
import { MerchantAliasDialog } from "./merchant-alias-dialog";
import { RenameMovementDialog } from "./rename-movement-dialog";
import { RowMenu, type RowMenuItem } from "./row-menu";

type ButtonState = "idle" | "loading" | "success" | "error";

const NOTICE_MS = 6000;

function aliasTitle(row: Movement): string {
  if (row.kind !== "transfer" && !/\b(pix|ted|doc|transf)/i.test(row.description))
    return "Dar nome a este lugar";
  return BigInt(row.amount) < 0n
    ? "Dar nome a quem recebeu"
    : "Dar nome a quem enviou";
}

function aliasNoticeText(saved: boolean, count: number): string {
  const unit = count === 1 ? "lançamento" : "lançamentos";
  return `Nome ${saved ? "salvo em" : "tirado de"} ${count} ${unit}`;
}

/**
 * Ações secundárias de uma linha de Movimentos: o menu "⋯" no canto e os
 * diálogos que ele abre. Fica FORA do <details> da linha porque um <dialog>
 * dentro de um <details> fechado não aparece. Removido pela pessoa: só "Voltar
 * a contar". Removido porque o banco não traz mais: nenhuma ação.
 */
export function MovementRowActions({
  row,
  categories,
  reader,
  canReject,
  busy,
  error,
  rejectState,
  onReject,
  renameState,
  onRename,
  kindChoices,
  kindState,
  onChangeKind,
  onRestore,
  onGoToReview,
  refresh,
  fixedOpen = false,
  onFixedClose,
}: {
  row: Movement;
  categories: { id: string; name: string; fixed?: boolean }[];
  reader: boolean;
  canReject: boolean;
  busy: boolean;
  error: string;
  rejectState?: ButtonState;
  onReject: (note: string, close: () => void) => void;
  renameState?: ButtonState;
  onRename: (name: string | null, close: () => void) => void;
  kindChoices: KindChoices;
  kindState?: ButtonState;
  onChangeKind: (draft: AdjustDraft, close: () => void) => void;
  onRestore: () => void;
  onGoToReview: () => void;
  refresh: () => Promise<void>;
  /** Aberto de fora (atalho no diálogo de categoria). */
  fixedOpen?: boolean;
  onFixedClose?: () => void;
}) {
  const [dialog, setDialog] = useState<"reject" | "fixed" | "rename" | "kind" | "alias" | null>(null);
  const [aliasNotice, setAliasNotice] = useState("");
  const close = () => {
    setDialog(null);
    onFixedClose?.();
  };
  const items: RowMenuItem[] = [];
  const event = row.id.startsWith("event:");
  const live = !row.removed;
  if (!reader && event && row.removed === "person")
    items.push({ label: "Voltar a contar", icon: "↺", onSelect: onRestore });
  const renamable = !reader && event && live;
  if (renamable)
    items.push({
      label: "Renomear",
      icon: "✎",
      onSelect: () => setDialog("rename"),
    });
  if (renamable)
    items.push({
      label: "Mudar tipo",
      icon: "⇄",
      onSelect: () => setDialog("kind"),
    });
  const nameable = !reader && live && (event || row.id.startsWith("bankpending:"));
  if (nameable)
    items.push({
      label: aliasTitle(row),
      icon: "✎",
      onSelect: () => setDialog("alias"),
    });
  if (!reader && live && rowAction(row))
    items.push({
      label: "Tornar conta fixa",
      icon: "↻",
      onSelect: () => setDialog("fixed"),
    });
  if (!reader && live && canReject)
    items.push({
      label: "Remover",
      icon: "✕",
      tone: "danger",
      onSelect: () => setDialog("reject"),
    });
  return (
    <>
      <RowMenu label={`Mais ações: ${movementTitle(row)}`} items={items} />
      {renamable && (
        <RenameMovementDialog
          open={dialog === "rename"}
          row={row}
          busy={busy}
          error={error}
          state={renameState}
          onClose={close}
          onConfirm={onRename}
        />
      )}
      {nameable && (
        <MerchantAliasDialog
          open={dialog === "alias"}
          title={aliasTitle(row)}
          movementId={row.id}
          onClose={close}
          onSave={async (alias) => {
            const { key_count } = await api<{ key_count: number }>(
              "merchant-alias",
              { movement_id: row.id, alias },
            );
            await refresh();
            setAliasNotice(aliasNoticeText(alias !== null, key_count));
            setTimeout(() => setAliasNotice(""), NOTICE_MS);
          }}
        />
      )}
      {aliasNotice && (
        <p role="status" className="ds-caption px-4 pb-2">
          {aliasNotice}
        </p>
      )}
      {renamable && (
        <ChangeKindDialog
          open={dialog === "kind"}
          row={row}
          choices={kindChoices}
          busy={busy}
          error={error}
          state={kindState}
          onClose={close}
          onConfirm={onChangeKind}
        />
      )}
      <FixedRowAction
        row={row}
        categories={categories}
        open={dialog === "fixed" || fixedOpen}
        onClose={close}
        onGoToReview={onGoToReview}
        refresh={refresh}
      />
      {canReject && (
        <RejectMovementDialog
          open={dialog === "reject"}
          busy={busy}
          error={error}
          state={rejectState}
          noteMax={event ? 300 : 1000}
          onClose={close}
          onConfirm={onReject}
        />
      )}
    </>
  );
}
