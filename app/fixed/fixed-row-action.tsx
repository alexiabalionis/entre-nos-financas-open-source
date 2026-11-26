"use client";
import { useState } from "react";
import type { Movement } from "../../src/domain/movements.ts";
import { Callout } from "../ds/callout";
import { FixedFromMovementDialog } from "./fixed-from-movement-dialog";
import { fixedOrigin } from "./fixed-form-model.ts";
import { rowAction, type FixedNotice } from "./fixed-row-model.ts";

/**
 * "Tornar conta fixa" de uma linha de Movimentos: o diálogo e o aviso de
 * sucesso. Quem abre é o menu "⋯" da linha, que controla `open`.
 */
export function FixedRowAction({
  row,
  categories,
  open,
  onClose,
  onGoToReview,
  refresh,
}: {
  row: Movement;
  categories: { id: string; name: string; fixed?: boolean }[];
  open: boolean;
  onClose: () => void;
  onGoToReview: () => void;
  refresh: () => Promise<void>;
}) {
  const [done, setDone] = useState<FixedNotice | null>(null);
  const mode = rowAction(row);
  if (!mode) return null;
  return (
    <>
      {done && (
        <Callout
          tone={done.tone}
          icon={done.tone === "ok" ? "✓" : "!"}
          title={done.title}
        >
          {done.body}
        </Callout>
      )}
      <FixedFromMovementDialog
        open={open}
        mode={mode}
        origin={fixedOrigin(row, categories)}
        categories={categories}
        onClose={onClose}
        onApprove={onGoToReview}
        onCreated={setDone}
        refresh={refresh}
      />
    </>
  );
}
