"use client";
import { useState } from "react";
import { FamilyDialog } from "../../../dialogs/family-dialog.tsx";
import { RejectMovementDialog } from "../../../movements/reject-movement-dialog.tsx";
import { AdjustForm } from "../adjust-form.tsx";
import { GoneNote, MovementList } from "../movement-list.tsx";
import { MovementRow } from "../movement-row.tsx";
import { useAdjust } from "../use-adjust.ts";
import type { Row } from "../fixture.ts";
import type { Store } from "../frame.tsx";

/**
 * Opção A: tudo pelo menu "⋯", como Renomear e Remover já são hoje. "Mudar
 * tipo" abre um diálogo centrado; "Remover" usa o diálogo que já existe. O
 * removido fica na lista, riscado, e o menu dele oferece "Voltar a contar".
 */
export function ScreenA({ store }: { store: Store }) {
  const adjust = useAdjust(store);
  const [editing, setEditing] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  return (
    <>
      <MovementList rows={store.rows}>
        {(row) => (
          <MovementRow
            row={row}
            flash={adjust.flashOf(row)}
            menu={adjust.menu(row, { adjust: () => setEditing(row), remove: () => setRemoving(row) })}
          >
            <GoneNote row={row} />
          </MovementRow>
        )}
      </MovementList>
      <FamilyDialog
        open={!!editing}
        title="Mudar o tipo deste movimento"
        description={editing?.description}
        busy={false}
        error=""
        onClose={() => setEditing(null)}
      >
        {editing && (
          <AdjustForm
            key={editing.id}
            row={editing}
            rows={store.rows}
            onSave={(c) => adjust.save(editing, c)}
            onClose={() => setEditing(null)}
          />
        )}
      </FamilyDialog>
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
