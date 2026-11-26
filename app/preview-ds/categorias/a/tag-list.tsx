"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Field } from "../../../field.tsx";
import { nameError, type Action, type Category, type Tag } from "../fixture.ts";
import { TagRow } from "./tag-row.tsx";
import { useFlash } from "./use-flash.ts";

/** Etiquetas de uma categoria: lista, renomear, excluir e campo de nova etiqueta. */
export function TagList({
  category,
  reader,
  initialDraft,
  dispatch,
  onAskDelete,
}: {
  category: Category;
  reader: boolean;
  /** Texto já digitado no campo (cenário de nome repetido). */
  initialDraft: string;
  dispatch: (a: Action) => void;
  onAskDelete: (tag: Tag) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [showError, setShowError] = useState(initialDraft !== "");
  const { flashed, flash } = useFlash();
  const names = category.tags.map((t) => t.name);
  const error = showError ? nameError(draft, names, "tag") : "";

  return (
    <div className="flex flex-col gap-3">
      {category.tags.length === 0 && (
        <p className="fine">
          {reader
            ? "Esta categoria não tem etiquetas."
            : "Esta categoria ainda não tem etiquetas. Crie a primeira abaixo para separar melhor os gastos."}
        </p>
      )}
      {category.tags.map((t) => (
        <TagRow
          key={t.id}
          tag={t}
          siblings={names}
          reader={reader}
          saved={flashed === `rename:${t.id}`}
          onRename={(name) => {
            dispatch({ type: "renameTag", categoryId: category.id, tagId: t.id, name });
            flash(`rename:${t.id}`);
          }}
          onDelete={() => (t.uses > 0 ? onAskDelete(t) : dispatch({ type: "deleteTag", categoryId: category.id, tagId: t.id }))}
        />
      ))}
      {!reader && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameError(draft, names, "tag")) {
              setShowError(true);
              return;
            }
            dispatch({ type: "addTag", categoryId: category.id, name: draft });
            setDraft("");
            setShowError(false);
            flash("add");
          }}
        >
          <Field label="Nova etiqueta" error={error}>
            <input
              className="input w-full"
              value={draft}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <div className="family-actions">
            <Button type="submit" variant="primary" size="sm" state={flashed === "add" ? "success" : "idle"} successLabel="Salvo">
              Adicionar etiqueta
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
