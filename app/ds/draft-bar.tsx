"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./button.tsx";

type DraftBarProps = {
  open: boolean;
  summary: ReactNode;
  onCompare?: () => void;
  compareLabel?: string;
  onDiscard: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saving?: boolean;
  confirmSave?: string;
};

/**
 * Barra de rascunho: aparece colada ao fim do conteúdo (sticky, não fixed) quando
 * há uma simulação não salva. Salvar pode pedir confirmação na própria barra.
 * Sem `onSave` (modo leitura) não há botão de salvar. Não sabe o que é um plano.
 */
export function DraftBar(props: DraftBarProps) {
  if (!props.open) return null;
  return <DraftBarOpen {...props} />;
}

// Componente interno: só existe com a barra aberta, então a confirmação
// reinicia sozinha quando ela fecha.
function DraftBarOpen({
  summary,
  onCompare,
  compareLabel = "Comparar tudo",
  onDiscard,
  onSave,
  saveLabel = "Salvar como plano",
  saving,
  confirmSave,
}: DraftBarProps) {
  const [confirming, setConfirming] = useState(false);
  const asking = confirming && Boolean(confirmSave) && Boolean(onSave);

  return (
    <div className="ds-reset ds-draftbar" role="region" aria-label="Simulação não salva">
      {asking ? (
        <div key="confirm" className="ds-draftbar-view">
          <p className="ds-draftbar-text" aria-live="polite">
            {confirmSave}
          </p>
          <div className="ds-draftbar-actions">
            <Button variant="quiet" onClick={() => setConfirming(false)} disabled={saving}>
              Voltar
            </Button>
            <Button variant="primary" state={saving ? "loading" : "idle"} onClick={onSave}>
              Confirmar
            </Button>
          </div>
        </div>
      ) : (
        <div key="summary" className="ds-draftbar-view">
          <p className="ds-draftbar-text" aria-live="polite">
            {summary}
          </p>
          <div className="ds-draftbar-actions">
            {onCompare ? (
              <Button variant="text" onClick={onCompare}>
                {compareLabel}
              </Button>
            ) : null}
            <Button variant="quiet" onClick={onDiscard} disabled={saving}>
              Descartar
            </Button>
            {onSave ? (
              <Button
                variant="primary"
                state={saving ? "loading" : "idle"}
                onClick={() => (confirmSave ? setConfirming(true) : onSave())}
              >
                {saveLabel}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
