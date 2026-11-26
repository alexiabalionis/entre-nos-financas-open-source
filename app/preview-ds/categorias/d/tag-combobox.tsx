"use client";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Icon } from "../../../ds/index.ts";
import type { Tag } from "../fixture.ts";
import { TagChip } from "./tag-chips.tsx";
import { TagListbox } from "./tag-listbox.tsx";
import { defaultActive, norm, searchTags, type TagOption } from "./tag-search.ts";

export type TagComboboxProps = {
  /** Nome acessível do campo, ex.: "Etiquetas de Casa". */
  label: string;
  /** Todas as etiquetas que a lista oferece (as da categoria). */
  tags: Tag[];
  /** Etiquetas mostradas como chips na caixa: todas (gestão) ou a escolhida (movimento). */
  chips: Tag[];
  /** x do chip. Sem ele os chips não têm x. Quem chama decide se exclui ou só tira. */
  onRemoveChip?: (tag: Tag) => void;
  /** aria-label do x; recebe o nome da etiqueta. */
  removeLabel?: (name: string) => string;
  /** Cria uma etiqueta nova com o nome já aparado. */
  onCreate: (name: string) => void;
  /** Salva o novo nome de uma etiqueta (já validado). */
  onRename: (tag: Tag, name: string) => void;
  /** Modo de escolha: chamado ao escolher uma etiqueta da lista ou ao criar uma. */
  onPick?: (name: string) => void;
  placeholder?: string;
  /** Nome (sem acento ou caixa) do chip a destacar por um instante. */
  flashKey?: string | null;
  /** Só mostra os chips: sem x, sem texto, sem lista. */
  readOnly?: boolean;
  /** Estados de partida (vitrine): lista aberta e texto já digitado. */
  initialOpen?: boolean;
  initialQuery?: string;
};

const BOX = "input h-auto min-h-10 w-full flex-wrap items-center gap-1 py-1";

/** Caixa de etiquetas: chips com x dentro, texto que busca ou cria, lista com lápis para renomear. */
export function TagCombobox({
  label,
  tags,
  chips,
  onRemoveChip,
  removeLabel = (n) => `Excluir etiqueta ${n}`,
  onCreate,
  onRename,
  onPick,
  placeholder = "Adicionar etiqueta",
  flashKey,
  readOnly = false,
  initialOpen = false,
  initialQuery = "",
}: TagComboboxProps) {
  const listId = useId();
  const inputId = useId();
  const errorId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(initialOpen);
  const [moved, setMoved] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const search = searchTags(tags, query);
  const { options, error } = search;
  const active = moved !== null && moved < options.length ? moved : defaultActive(search, query);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (readOnly)
    return (
      <div className={BOX} role="group" aria-label={label}>
        {chips.map((t) => (
          <TagChip key={t.id} tag={t} flashed={false} removeLabel={removeLabel} />
        ))}
        {chips.length === 0 ? <span className="text-sm text-base-content/60">Sem etiquetas ainda.</span> : null}
      </div>
    );

  const refocus = () => input.current?.focus();

  function choose(o: TagOption) {
    if (o.kind === "create") {
      onCreate(o.name);
      onPick?.(o.name);
    } else onPick?.(o.tag.name);
    setQuery("");
    setMoved(null);
    setOpen(false);
    refocus();
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setMoved(active < 0 ? (step === 1 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0) choose(options[active]);
    } else if (e.key === "Backspace" && query === "") {
      // Só foca o último x; excluir é uma decisão explícita.
      const xs = root.current?.querySelectorAll<HTMLButtonElement>("[data-chip-x]");
      if (xs && xs.length > 0) {
        e.preventDefault();
        xs[xs.length - 1].focus();
      }
    }
  }

  function onRootKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    e.stopPropagation();
    if (editingId) setEditingId(null);
    else setOpen(false);
    refocus();
  }

  function onRootBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && !root.current?.contains(next)) {
      setOpen(false);
      setEditingId(null);
    }
  }

  return (
    <div ref={root} onKeyDown={onRootKey} onBlur={onRootBlur} className="relative">
      {/* htmlFor fixa o campo de texto como o controle do label. Sem ele, um clique no vazio da
          caixa seria repassado ao primeiro botão dentro do label, que é o x do primeiro chip. */}
      <label
        htmlFor={inputId}
        className={BOX}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          setOpen(true);
        }}
      >
        {chips.map((t) => (
          <TagChip
            key={t.id}
            tag={t}
            flashed={flashKey === norm(t.name)}
            onRemove={onRemoveChip}
            removeLabel={removeLabel}
          />
        ))}
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          className="min-w-20 flex-1"
          placeholder={placeholder}
          autoComplete="off"
          value={query}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setMoved(null);
            setOpen(true);
          }}
          onKeyDown={onInputKey}
        />
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle ml-auto"
          aria-label={open ? "Fechar lista de etiquetas" : "Abrir lista de etiquetas"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (open) setOpen(false);
            else {
              setOpen(true);
              refocus();
            }
          }}
        >
          <Icon name={open ? "up" : "down"} size={16} />
        </button>
      </label>
      {error ? (
        <small id={errorId} className="family-error label text-error whitespace-normal" role="alert">
          {error}
        </small>
      ) : null}
      {open ? (
        <TagListbox
          id={listId}
          options={options}
          activeIndex={active}
          tags={tags}
          chipIds={chips.map((c) => c.id)}
          editingId={editingId}
          onChoose={choose}
          onEdit={(t) => setEditingId(t.id)}
          onSave={(t, name) => {
            onRename(t, name);
            setEditingId(null);
            refocus();
          }}
          onCancel={() => {
            setEditingId(null);
            refocus();
          }}
        />
      ) : (
        <ul id={listId} role="listbox" hidden aria-label="Etiquetas" />
      )}
    </div>
  );
}
