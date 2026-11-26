"use client";
import { useState } from "react";
import { Button, IconButton } from "../../../ds/index.ts";
import { Row } from "../../../ds/row.tsx";
import { Field } from "../../../field.tsx";
import { movementCount, nameError, type Tag } from "../fixture.ts";

/** Uma etiqueta: linha com ações, ou formulário de renomear no lugar. */
export function TagRow({
  tag,
  siblings,
  reader,
  saved,
  onRename,
  onDelete,
}: {
  tag: Tag;
  siblings: string[];
  reader: boolean;
  saved: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [showError, setShowError] = useState(false);
  const others = siblings.filter((n) => n !== tag.name);
  const error = showError ? nameError(name, others, "tag") : "";
  const cancel = () => {
    setEditing(false);
    setName(tag.name);
    setShowError(false);
  };

  if (editing)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nameError(name, others, "tag")) {
            setShowError(true);
            return;
          }
          onRename(name.trim());
          setEditing(false);
          setShowError(false);
        }}
      >
        <Field label="Novo nome da etiqueta" error={error}>
          <input
            className="input w-full"
            value={name}
            autoFocus
            aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && cancel()}
          />
        </Field>
        <div className="family-actions">
          <Button size="sm" onClick={cancel}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Salvar nome
          </Button>
        </div>
      </form>
    );

  return (
    <Row
      bordered
      title={tag.name}
      sub={tag.uses === 0 ? "Ainda sem movimentos" : movementCount(tag.uses)}
      trail={
        reader ? undefined : (
          <span className="flex items-center gap-1">
            <Button variant="text" size="sm" state={saved ? "success" : "idle"} successLabel="Salvo" onClick={() => setEditing(true)}>
              Renomear
            </Button>
            <IconButton icon="close" size="sm" label={`Excluir etiqueta ${tag.name}`} onClick={onDelete} />
          </span>
        )
      }
    />
  );
}
