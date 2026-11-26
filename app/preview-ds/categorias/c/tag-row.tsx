"use client";
import { useState, type FormEvent } from "react";
import { Button } from "../../../ds/index.ts";
import { Row } from "../../../ds/row.tsx";
import { Field } from "../../../field";
import { nameError, type Action, type Category, type Tag } from "../fixture.ts";
import { useFlash } from "./use-flash.ts";

/** Etiqueta no modo de edição: linha com renomear e excluir, ou o campo de renomear. */
export function TagRow({
  category,
  tag,
  dispatch,
  onDelete,
}: {
  category: Category;
  tag: Tag;
  dispatch: (a: Action) => void;
  onDelete: (t: Tag) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [saved, flash] = useFlash();
  const error = nameError(
    name,
    category.tags.filter((t) => t.id !== tag.id).map((t) => t.name),
    "tag",
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (error) return;
    dispatch({ type: "renameTag", categoryId: category.id, tagId: tag.id, name });
    flash(() => setRenaming(false));
  }

  if (!renaming) {
    return (
      <Row
        title={tag.name}
        sub={tag.uses === 0 ? "Sem uso" : tag.uses === 1 ? "Em 1 movimento" : `Em ${tag.uses} movimentos`}
        trail={
          <span className="flex items-center gap-1">
            <Button variant="text" size="sm" onClick={() => setRenaming(true)} aria-label={`Renomear ${tag.name}`}>
              Renomear
            </Button>
            <Button variant="text" size="sm" onClick={() => onDelete(tag)} aria-label={`Excluir ${tag.name}`}>
              Excluir
            </Button>
          </span>
        }
      />
    );
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-2"
      aria-label={`Renomear ${tag.name}`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        setName(tag.name);
        setRenaming(false);
      }}
    >
      <Field label="Novo nome" error={error}>
        <input className="input w-full" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" state={saved ? "success" : "idle"} successLabel="Salvo" disabled={Boolean(error)}>
          Salvar
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setName(tag.name);
            setRenaming(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
