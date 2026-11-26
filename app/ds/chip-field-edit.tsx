"use client";
import { useState } from "react";
import { Icon } from "./icon.tsx";
import type { ChipItem } from "./chip-field-search.ts";

/** A própria linha vira o campo de renomear. Enter salva, Esc cancela; o erro bloqueia o envio. */
export function ChipFieldEdit({
  item,
  fieldLabel,
  saveLabel,
  cancelLabel,
  validate,
  serverError,
  busy,
  onSave,
  onCancel,
}: {
  item: ChipItem;
  /** aria-label do campo de texto. */
  fieldLabel: string;
  saveLabel: string;
  cancelLabel: string;
  validate?: (name: string, exceptId?: string) => string;
  /** Erro devolvido por quem salvou; some quando a pessoa volta a digitar. */
  serverError?: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [typed, setTyped] = useState(false);
  const own = validate ? validate(name, item.id) : "";
  const error = own || (typed ? "" : (serverError ?? ""));
  const save = () => {
    if (!own && !busy) onSave(name.trim());
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-3 py-1">
        <label className="input input-sm flex-1">
          <input
            value={name}
            autoFocus
            aria-label={fieldLabel}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setTyped(true);
            }}
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
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          aria-label={saveLabel}
          disabled={Boolean(own) || busy}
          onClick={save}
        >
          <Icon name="check" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-xs btn-circle" aria-label={cancelLabel} onClick={onCancel}>
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
