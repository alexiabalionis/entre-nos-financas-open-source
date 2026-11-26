"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { AdjustForm } from "../adjust-form.tsx";
import type { Change, Row } from "../fixture.ts";

/**
 * Ajuste dentro da própria linha aberta: "Corrigir tipo" troca o detalhe pelo
 * formulário, e "Remover" pede a confirmação ali mesmo, sem janela por cima.
 */
export function InlineAdjust({
  row,
  rows,
  editing,
  onEdit,
  onSave,
  onRemove,
}: {
  row: Row;
  rows: Row[];
  editing: boolean;
  onEdit: (on: boolean) => void;
  onSave: (c: Change) => string;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  if (editing)
    return (
      <div className="mt-3 border-t border-base-200 pt-3">
        <AdjustForm row={row} rows={rows} onSave={onSave} onClose={() => onEdit(false)} />
      </div>
    );
  if (confirm)
    return (
      <div className="mt-3 grid gap-2 border-t border-base-200 pt-3">
        <p className="ds-caption">Ele para de contar nos gastos e entradas do mês. A leitura do banco continua guardada.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRemove}>
            Remover
          </Button>
          <Button variant="quiet" onClick={() => setConfirm(false)}>
            Voltar
          </Button>
        </div>
      </div>
    );
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-base-200 pt-3">
      <Button size="sm" icon="⇄" onClick={() => onEdit(true)}>
        {row.auto ? "Não é isso? Corrigir tipo" : "Corrigir tipo"}
      </Button>
      <Button size="sm" variant="text" className="text-error" onClick={() => setConfirm(true)}>
        Remover
      </Button>
    </div>
  );
}
