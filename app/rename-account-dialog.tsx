"use client";
import { useState } from "react";
import { Button } from "./button";
import { FamilyDialog } from "./dialogs/family-dialog";

/**
 * Diálogo de "Renomear conta" ou "Renomear cartão". Nome vazio não grava
 * (erro inline). Erros do servidor, como nome longo demais, aparecem na
 * própria janela. Quem chama faz a gravação em onSave e lança Error se falhar.
 */
export function RenameAccountDialog({
  open,
  title,
  initialName,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    setError("");
    onClose();
  };
  return (
    <FamilyDialog
      open={open}
      title={title}
      busy={busy}
      error={open ? error : ""}
      onClose={close}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(
            new FormData(e.currentTarget).get("name") ?? "",
          ).trim();
          if (!name) {
            setError("Escreva um nome para continuar.");
            return;
          }
          setError("");
          setBusy(true);
          onSave(name)
            .then(close)
            .catch((err: unknown) =>
              setError(
                err instanceof Error
                  ? err.message
                  : "Não foi possível concluir. Tente novamente.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <p className="ds-caption">
          Só muda o nome que vocês veem no app. O nome do banco continua
          guardado.
        </p>
        <label>
          Nome
          <input name="name" defaultValue={initialName} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            state={busy ? "loading" : "idle"}
            busyLabel="Salvando…"
          >
            Salvar
          </Button>
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
