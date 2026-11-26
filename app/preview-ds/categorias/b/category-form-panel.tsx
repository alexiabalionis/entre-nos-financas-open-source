"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { Row } from "../../../ds/row.tsx";
import { StatusChip } from "../../../ds/status-chip.tsx";
import { Field } from "../../../field.tsx";
import { movementCount, nameError, type Category } from "../fixture.ts";

/** Nome e "Gasto essencial" editáveis no lugar; leitura mostra só os dados. */
export function CategoryFormPanel({
  category,
  siblings,
  reader,
  saved,
  onSave,
}: {
  category: Category;
  siblings: string[];
  reader: boolean;
  saved: boolean;
  onSave: (name: string, essential: boolean) => void;
}) {
  const [name, setName] = useState(category.name);
  const [essential, setEssential] = useState(category.essential);
  const [showError, setShowError] = useState(false);
  const error = showError ? nameError(name, siblings, "category") : "";

  if (reader)
    return (
      <Panel title="Categoria">
        <Row
          title={category.name}
          sub={movementCount(category.movements)}
          trail={category.essential ? <StatusChip label="Essencial" tone="accent" /> : undefined}
        />
      </Panel>
    );

  return (
    <Panel title="Categoria">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nameError(name, siblings, "category")) {
            setShowError(true);
            return;
          }
          setShowError(false);
          setName(name.trim());
          onSave(name.trim(), essential);
        }}
      >
        <Field label="Nome da categoria" error={error}>
          <input
            className="input w-full"
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
          Gasto essencial
        </label>
        <div className="family-actions">
          <Button type="submit" variant="primary" state={saved ? "success" : "idle"} successLabel="Salvo">
            Salvar categoria
          </Button>
        </div>
      </form>
    </Panel>
  );
}
