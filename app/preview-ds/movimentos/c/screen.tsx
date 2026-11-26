"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { GoneNote, MovementList } from "../movement-list.tsx";
import { MovementRow } from "../movement-row.tsx";
import { useAdjust } from "../use-adjust.ts";
import { InlineAdjust } from "./inline-adjust.tsx";
import type { Store } from "../frame.tsx";

/**
 * Opção C: o ajuste fica no detalhe da linha, onde o tipo já aparece. Abrir a
 * linha mostra "Corrigir tipo" e "Remover"; nada abre por cima. O menu "⋯" leva
 * ao mesmo lugar, abrindo a linha já no formulário.
 */
export function ScreenC({ store }: { store: Store }) {
  const adjust = useAdjust(store);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <MovementList rows={store.rows}>
      {(row) => (
        <MovementRow
          row={row}
          flash={adjust.flashOf(row)}
          open={open === row.id}
          onOpenChange={(on) => {
            setOpen(on ? row.id : null);
            if (!on) setEditing(null);
          }}
          menu={adjust.menu(row, {
            adjust: () => {
              setOpen(row.id);
              setEditing(row.id);
            },
            remove: () => setOpen(row.id),
          })}
        >
          <GoneNote row={row} />
          {!store.reader && row.removed === "você" && (
            <div className="mt-3 border-t border-base-200 pt-3">
              <Button size="sm" icon="↺" onClick={() => adjust.restore(row)}>
                Voltar a contar
              </Button>
            </div>
          )}
          {!store.reader && !row.removed && (
            <InlineAdjust
              key={row.kind + row.id}
              row={row}
              rows={store.rows}
              editing={editing === row.id}
              onEdit={(on) => setEditing(on ? row.id : null)}
              onSave={(c) => adjust.save(row, c)}
              onRemove={() => {
                adjust.remove(row);
                setOpen(null);
              }}
            />
          )}
        </MovementRow>
      )}
    </MovementList>
  );
}
