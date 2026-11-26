"use client";
import { useState, type FormEvent } from "react";
import { Button } from "../../../ds/index.ts";
import { Field } from "../../../field";
import { nameError, type Action, type Category } from "../fixture.ts";
import { useFlash } from "./use-flash.ts";

/** Formulário de nova etiqueta. O erro aparece no campo e bloqueia o envio. */
export function TagAdder({
  category,
  dispatch,
  initial = "",
}: {
  category: Category;
  dispatch: (a: Action) => void;
  initial?: string;
}) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(initial !== "");
  const [saved, flash] = useFlash();
  const siblings = category.tags.map((t) => t.name);
  const error = touched ? nameError(name, siblings, "tag") : "";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError(name, siblings, "tag")) return;
    dispatch({ type: "addTag", categoryId: category.id, name });
    setName("");
    setTouched(false);
    flash();
  }

  return (
    <form onSubmit={submit} className="grid gap-2" aria-label={`Nova etiqueta em ${category.name}`}>
      <Field label="Nova etiqueta" error={error}>
        <input
          className="input w-full"
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" size="sm" icon="plus" state={saved ? "success" : "idle"} successLabel="Etiqueta criada">
          Adicionar etiqueta
        </Button>
      </div>
    </form>
  );
}
