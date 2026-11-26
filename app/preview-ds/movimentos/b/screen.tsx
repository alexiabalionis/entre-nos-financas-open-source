"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Sheet } from "../../../ds/sheet.tsx";
import { RejectMovementDialog } from "../../../movements/reject-movement-dialog.tsx";
import { AdjustForm } from "../adjust-form.tsx";
import { GoneNote, MovementList } from "../movement-list.tsx";
import { MovementRow } from "../movement-row.tsx";
import { useAdjust } from "../use-adjust.ts";
import { KIND_LABEL, money, type Row } from "../fixture.ts";
import type { Store } from "../frame.tsx";

/**
 * Opção B: um lugar só para ajustar. "Ajustar" (no menu ou no detalhe da
 * linha) abre a folha de baixo com o tipo e, no fim, Remover. Menos itens no
 * menu; um toque a mais para remover.
 */
export function ScreenB({ store }: { store: Store }) {
  const adjust = useAdjust(store);
  const [editing, setEditing] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const openRemove = (row: Row) => {
    setEditing(null);
    setRemoving(row);
  };
  return (
    <>
      <MovementList rows={store.rows}>
        {(row) => (
          <MovementRow
            row={row}
            flash={adjust.flashOf(row)}
            menu={adjust.menu(row, { adjust: () => setEditing(row), remove: () => openRemove(row) }, true)}
          >
            <GoneNote row={row} />
            {!store.reader && !row.removed && (
              <Button className="mt-3" size="sm" icon="⇄" onClick={() => setEditing(row)}>
                Ajustar
              </Button>
            )}
          </MovementRow>
        )}
      </MovementList>
      <Sheet open={!!editing} title="Ajustar movimento" onClose={() => setEditing(null)}>
        {editing && (
          <div className="grid gap-4">
            <p className="ds-caption">
              {editing.description} · {money(editing.cents)}
              <br />
              Hoje: {KIND_LABEL[editing.kind]}
              {editing.auto ? ", decidido pelo app." : "."}
            </p>
            <AdjustForm
              key={editing.id}
              row={editing}
              rows={store.rows}
              onSave={(c) => adjust.save(editing, c)}
              onClose={() => setEditing(null)}
            />
            <div className="border-t border-base-200 pt-3">
              <Button variant="text" className="text-error" onClick={() => openRemove(editing)}>
                Remover dos totais
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <RejectMovementDialog
        open={!!removing}
        busy={false}
        error=""
        onClose={() => setRemoving(null)}
        onConfirm={(_note, close) => {
          if (removing) adjust.remove(removing);
          close();
        }}
      />
    </>
  );
}
