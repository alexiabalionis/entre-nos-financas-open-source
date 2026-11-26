"use client";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";

type ButtonState = "idle" | "loading" | "success" | "error";

/**
 * Diálogo de "Remover" um movimento do banco: a única ação sobre o que o banco
 * leu (tudo o mais conta sozinho). O motivo é opcional. Quem abre é o menu "⋯"
 * da linha. Quem chama faz a gravação e fecha o diálogo pelo `close` recebido
 * em onConfirm, só quando der certo.
 */
export function RejectMovementDialog({
  open,
  busy,
  error,
  state,
  noteMax = 1000,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  state?: ButtonState;
  /** Tamanho máximo do motivo: 1000 na linha do banco, 300 no lançamento. */
  noteMax?: number;
  onClose: () => void;
  onConfirm: (note: string, close: () => void) => void;
}) {
  return (
    <FamilyDialog
      open={open}
      title="Remover este movimento?"
      busy={busy}
      error={open ? error : ""}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const note = String(new FormData(e.currentTarget).get("note") ?? "");
          onConfirm(note.trim(), onClose);
        }}
      >
        <p className="ds-caption">
          Ele para de contar nos gastos e entradas do mês. A leitura do banco
          continua guardada.
        </p>
        <label>
          Motivo (opcional)
          <input
            name="note"
            maxLength={noteMax}
            placeholder="Ex.: não é um gasto da família"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            state={state}
            busyLabel="Removendo…"
          >
            Remover
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={onClose}
          >
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
