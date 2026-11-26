"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Field } from "../../../field.tsx";
import { FamilyDialog } from "../../../dialogs/family-dialog.tsx";
import { nameError, type Category } from "../fixture.ts";

/** null = fechado; sem category = nova categoria. */
export type CategoryDialogTarget = { category?: Category } | null;

function CategoryForm({
  category,
  categories,
  onSave,
  onClose,
}: {
  category?: Category;
  categories: Category[];
  onSave: (name: string, essential: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [essential, setEssential] = useState(category?.essential ?? false);
  const [showError, setShowError] = useState(false);
  const siblings = categories.filter((c) => c.id !== category?.id).map((c) => c.name);
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
          {category ? "Salvar categoria" : "Criar categoria"}
        </Button>
      </div>
    </form>
  );
}

/** Formulário em janela para criar ou editar categoria. */
export function CategoryDialog({
  target,
  categories,
  onSave,
  onClose,
}: {
  target: CategoryDialogTarget;
  categories: Category[];
  onSave: (name: string, essential: boolean) => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog
      open={target !== null}
      title={target?.category ? "Editar categoria" : "Nova categoria"}
      busy={false}
      error=""
      onClose={onClose}
    >
      {target && (
        <CategoryForm category={target.category} categories={categories} onSave={onSave} onClose={onClose} />
      )}
    </FamilyDialog>
  );
}
