"use client";
import { useState } from "react";
import { Icon } from "../../../ds/index.ts";
import { nameError, type Tag } from "../fixture.ts";

/** A própria linha vira o campo de renomear. Enter salva, Esc cancela; o erro bloqueia o envio. */
export function TagEditForm({
  tag,
  siblings,
  onSave,
  onCancel,
}: {
  tag: Tag;
  siblings: string[];
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const error = nameError(name, siblings, "tag");
  const save = () => {
    if (!error) onSave(name);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-3 py-1">
        <label className="input input-sm flex-1">
          <input
            value={name}
            autoFocus
            aria-label={`Novo nome da etiqueta ${tag.name}`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
            }}
          />
        </label>
        <button type="button" className="btn btn-ghost btn-xs btn-circle" aria-label="Salvar nome" disabled={Boolean(error)} onClick={save}>
          <Icon name="check" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-xs btn-circle" aria-label="Cancelar" onClick={onCancel}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {error ? (
        <small className="px-3 text-xs text-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
