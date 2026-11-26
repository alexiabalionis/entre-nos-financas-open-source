"use client";
import { Select } from "../../../ds/select.tsx";
import { useState } from "react";
import { Button, Icon, Segmented } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import type { Store } from "../frame.tsx";
import { ManageSheet } from "./manage-sheet.tsx";

type Kind = "all" | "in" | "out";

/** Topo de Movimentos (mesma marcação de app/family-movements.tsx) com o atalho para gerenciar categorias. */
export function MovementsContext({ store }: { store: Store }) {
  const [open, setOpen] = useState(store.scenario !== "normal");
  const [kind, setKind] = useState<Kind>("all");
  return (
    <>
      <section aria-label="Buscar e filtrar movimentos">
        <Panel>
          <label className="input min-w-0 flex-1">
            <Icon name="search" size={18} className="opacity-50" />
            <span className="sr-only">Buscar movimentos</span>
            <input type="search" className="grow" placeholder="Buscar descrição, conta ou categoria" />
          </label>
          <div className="flex flex-col gap-2">
            <div className="max-w-full overflow-x-auto">
              <Segmented
                size="sm"
                label="Tipo de movimento"
                value={kind}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "in", label: "Entradas" },
                  { value: "out", label: "Saídas" },
                ]}
                onChange={setKind}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select size="sm" className="min-w-40 flex-1" aria-label="Filtrar por conta" defaultValue="">
                <option value="">Todas as contas</option>
                <option>Conta corrente</option>
                <option>Cartão de crédito</option>
              </Select>
              <Select size="sm" className="min-w-40 flex-1" aria-label="Filtrar por categoria" defaultValue="">
                <option value="">Todas as categorias</option>
                {store.categories.map((c) => (
                  <option key={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Button variant="quiet" size="sm" icon="layers" onClick={() => setOpen(true)}>
                Gerenciar categorias
              </Button>
            </div>
          </div>
        </Panel>
      </section>
      <ManageSheet store={store} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
