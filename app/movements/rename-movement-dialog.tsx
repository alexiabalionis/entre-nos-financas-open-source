"use client";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import { movementTitle, type Movement } from "../../src/domain/movements.ts";

type ButtonState = "idle" | "loading" | "success" | "error";

/**
 * Diálogo de "Renomear" um lançamento confirmado. O nome vazio nunca é gravado
 * em silêncio: mostra erro e pede um nome ou o retorno ao original. Quem chama
 * faz a gravação e fecha o diálogo pelo `close` recebido em onConfirm.
 */
export function RenameMovementDialog({
  open,
  row,
  busy,
  error,
  state,
  onClose,
  onConfirm,
}: {
  open: boolean;
  row: Movement;
  busy: boolean;
  error: string;
  state?: ButtonState;
  onClose: () => void;
  onConfirm: (name: string | null, close: () => void) => void;
}) {
  const [formError, setFormError] = useState("");
  const hasNickname = movementTitle(row) !== row.description;
  const close = () => {
    setFormError("");
    onClose();
  };
  return (
    <FamilyDialog
      open={open}
      title="Renomear este movimento"
      busy={busy}
      error={open ? formError || error : ""}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(
            new FormData(e.currentTarget).get("name") ?? "",
          ).trim();
          if (!name) {
            setFormError(
              "Escreva um nome ou use Voltar ao nome original.",
            );
            return;
          }
          setFormError("");
          onConfirm(name, close);
        }}
      >
        <p className="ds-caption">
          O nome original do banco continua guardado e aparece em letras
          pequenas.
        </p>
        <label>
          Nome
          <input
            key={movementTitle(row)}
            name="name"
            maxLength={120}
            defaultValue={movementTitle(row)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            state={state}
            busyLabel="Salvando…"
          >
            Salvar
          </Button>
          {hasNickname && (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => onConfirm(null, close)}
            >
              Voltar ao nome original
            </Button>
          )}
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={close}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
