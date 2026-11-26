"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { FamilyDialog } from "../../../dialogs/family-dialog.tsx";
import { Field } from "../../../field.tsx";
import { nameError, type Category } from "../fixture.ts";

function NewCategoryForm({
  categories,
  onSave,
  onClose,
}: {
  categories: Category[];
  onSave: (name: string, essential: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [essential, setEssential] = useState(false);
  const [showError, setShowError] = useState(false);
  const siblings = categories.map((c) => c.name);
  const error = showError ? nameError(name, siblings, "category") : "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (nameError(name, siblings, "category")) {
          setShowError(true);
          return;
        }
        onSave(name.trim(), essential);
      }}
    >
      <Field label="Nome da categoria" error={error}>
        <input
          className="input w-full"
          value={name}
          autoFocus
          aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
        Gasto essencial
      </label>
      <div className="family-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary">
          Criar categoria
        </Button>
      </div>
    </form>
  );
}

/** Janela para criar uma categoria. */
export function NewCategoryDialog({
  open,
  categories,
  onSave,
  onClose,
}: {
  open: boolean;
  categories: Category[];
  onSave: (name: string, essential: boolean) => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog open={open} title="Nova categoria" busy={false} error="" onClose={onClose}>
      <NewCategoryForm categories={categories} onSave={onSave} onClose={onClose} />
    </FamilyDialog>
  );
}
