"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { Field } from "../../../field.tsx";
import { nameError, tagCount, type Action, type Category } from "../fixture.ts";
import { TagRow } from "./tag-row.tsx";

/** Etiquetas da categoria: lista com renomear e excluir, mais o formulário de nova etiqueta. */
export function TagListPanel({
  category,
  reader,
  flashed,
  flash,
  dispatch,
  startWithDuplicate,
  onAskDelete,
}: {
  category: Category;
  reader: boolean;
  flashed: string;
  flash: (key: string) => void;
  dispatch: (a: Action) => void;
  startWithDuplicate: boolean;
  onAskDelete: (tagName: string) => void;
}) {
  const [name, setName] = useState(startWithDuplicate ? "vestuário" : "");
  const [showError, setShowError] = useState(startWithDuplicate);
  const names = category.tags.map((t) => t.name);
  const error = showError ? nameError(name, names, "tag") : "";

  return (
    <Panel title="Etiquetas" meta={tagCount(category.tags.length)}>
      {category.tags.length === 0 && (
        <p className="fine">
          {reader
            ? "Esta categoria ainda não tem etiquetas."
            : "Esta categoria ainda não tem etiquetas. Crie a primeira abaixo para separar seus gastos."}
        </p>
      )}
      <div className="ds-list list gap-0">
        {category.tags.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            siblings={names}
            reader={reader}
            saved={flashed === `tag:${t.id}`}
            onRename={(next) => {
              dispatch({ type: "renameTag", categoryId: category.id, tagId: t.id, name: next });
              flash(`tag:${t.id}`);
            }}
            onDelete={() =>
              t.uses > 0 ? onAskDelete(t.name) : dispatch({ type: "deleteTag", categoryId: category.id, tagId: t.id })
            }
          />
        ))}
      </div>
      {!reader && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameError(name, names, "tag")) {
              setShowError(true);
              return;
            }
            dispatch({ type: "addTag", categoryId: category.id, name });
            flash(`add:${category.id}`);
            setName("");
            setShowError(false);
          }}
        >
          <Field label="Nova etiqueta" error={error}>
            <input
              className="input w-full"
              value={name}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="family-actions">
            <Button type="submit" variant="primary" state={flashed === `add:${category.id}` ? "success" : "idle"} successLabel="Adicionada">
              Adicionar etiqueta
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
