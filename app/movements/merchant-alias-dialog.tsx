"use client";
import { useEffect, useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import { api } from "../lib/api";

type Reach = { alias: string | null; key_count: number };

/**
 * Diálogo de "Dar nome a quem recebeu/enviou/este lugar". Ao abrir, lê o nome
 * atual e quantos lançamentos o nome alcança. Quem chama grava em onSave
 * (alias null tira o nome) e lança Error se falhar.
 */
export function MerchantAliasDialog({
  open,
  title,
  movementId,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  movementId: string;
  onClose: () => void;
  onSave: (alias: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reach, setReach] = useState<Reach | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<Reach>(`merchant-alias?movement_id=${encodeURIComponent(movementId)}`)
      .then((value) => live && setReach(value))
      .catch(() => live && setReach(null));
    return () => {
      live = false;
    };
  }, [open, movementId]);
  const close = () => {
    setError("");
    onClose();
  };
  const save = (alias: string | null) => {
    setError("");
    setBusy(true);
    onSave(alias)
      .then(close)
      .catch((err: unknown) =>
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível concluir. Tente novamente.",
        ),
      )
      .finally(() => setBusy(false));
  };
  const scope =
    reach && reach.key_count > 1
      ? `Vale para os ${reach.key_count} lançamentos com este nome no banco, e para os próximos.`
      : "Vale para todos os lançamentos com este nome no banco, e para os próximos.";
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
          const alias = String(
            new FormData(e.currentTarget).get("alias") ?? "",
          ).trim();
          if (!alias) {
            setError("Escreva um nome para continuar.");
            return;
          }
          save(alias);
        }}
      >
        <p className="ds-caption">
          {scope} Se a conversa com IA estiver ligada, a Judite vê este nome.
        </p>
        <label>
          Nome
          <input
            key={reach?.alias ?? ""}
            name="alias"
            maxLength={60}
            placeholder="Ex.: Faxina, Feira da Josefa"
            defaultValue={reach?.alias ?? ""}
          />
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
          {reach?.alias && (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => save(null)}
            >
              Tirar nome
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
