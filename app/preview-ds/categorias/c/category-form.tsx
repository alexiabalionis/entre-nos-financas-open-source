"use client";
import { useState, type FormEvent } from "react";
import { Button } from "../../../ds/index.ts";
import { Field } from "../../../field";
import { nameError, type Action, type Category } from "../fixture.ts";
import { useFlash } from "./use-flash.ts";

/** Criar ou editar categoria dentro do próprio Sheet. Sem excluir categoria. */
export function CategoryForm({
  category,
  categories,
  dispatch,
  onDone,
}: {
  category?: Category;
  categories: Category[];
  dispatch: (a: Action) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [essential, setEssential] = useState(category?.essential ?? false);
  const [touched, setTouched] = useState(false);
  const [saved, flash] = useFlash();
  const siblings = categories.filter((c) => c.id !== category?.id).map((c) => c.name);
  const error = touched ? nameError(name, siblings, "category") : "";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError(name, siblings, "category")) return;
    dispatch(category ? { type: "editCategory", id: category.id, name, essential } : { type: "addCategory", name, essential });
    flash(onDone);
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4"
      aria-label={category ? "Editar categoria" : "Nova categoria"}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onDone();
      }}
    >
      <Field label="Nome da categoria" error={error}>
        <input
          className="input w-full"
          value={name}
          autoFocus
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
        Gasto essencial
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" state={saved ? "success" : "idle"} successLabel="Salvo">
          {category ? "Salvar categoria" : "Criar categoria"}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
