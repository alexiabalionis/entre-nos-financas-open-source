"use client";
import { useState, type ReactNode } from "react";
import { Button } from "../../ds/index.ts";
import { draftOf, KindFields } from "./kind-fields.tsx";
import type { Change, Row } from "./fixture.ts";

/**
 * Formulário de troca de tipo com Salvar e Voltar, igual nas três opções.
 * O erro só aparece depois de tentar salvar e fica no campo que falta; o
 * envio é bloqueado, nada é gravado pela metade.
 */
export function AdjustForm({
  row,
  rows,
  onSave,
  onClose,
  extra,
}: {
  row: Row;
  rows: Row[];
  onSave: (c: Change) => string;
  onClose: () => void;
  /** Ação a mais no rodapé (ex.: Remover, na opção B). */
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState<Change>(() => draftOf(row));
  const [error, setError] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = onSave(draft);
        setError(problem);
        if (!problem) onClose();
      }}
    >
      <KindFields
        row={row}
        rows={rows}
        value={draft}
        error={error}
        onChange={(c) => {
          setDraft(c);
          setError("");
        }}
      />
      {error && !/conta|compra|categoria/.test(error) && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Salvar
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Voltar
        </Button>
        {extra}
      </div>
    </form>
  );
}
