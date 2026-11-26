"use client";
/**
 * ChipField: caixa de chips com texto que busca ou cria e lista com lápis para renomear.
 *
 * API genérica, sem domínio. Todo texto visível vem do chamador.
 * - label: nome acessível do campo.
 * - items: opções da lista. chips: itens mostrados como chips na caixa.
 * - onCreate(name): cria; sem ele não há a opção de criar. Pode devolver (ou
 *   resolver com) uma mensagem de erro, que aparece sob o campo.
 * - onRename(item, name): renomeia; sem ele não há lápis. Mesmo contrato de erro.
 * - onRemoveChip(item): sem ele os chips não têm x.
 * - onPick(item): modo escolha, ao escolher um item existente da lista.
 * - validate(name, exceptId?): mensagem de erro do nome, ou "".
 * - placeholder, createLabel(name), removeLabel(name), renameLabel(name), text.
 * - readOnly: só os chips. flashId: chip a destacar. busy: bloqueia as ações.
 * Teclado e ARIA: combobox com lista, setas, Enter, Esc, Backspace foca o último x.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "./icon.tsx";
import { ChipFieldChip } from "./chip-field-chips.tsx";
import { ChipFieldList } from "./chip-field-list.tsx";
import {
  defaultActive,
  searchChips,
  type ChipItem,
  type ChipOption,
} from "./chip-field-search.ts";

export type { ChipItem } from "./chip-field-search.ts";

type SaveResult = void | string | Promise<void | string>;

export type ChipFieldText = {
  /** aria-label da lista de opções. */
  list: string;
  /** Lista sem nenhum item. */
  empty: string;
  /** Texto digitado que não casa com nenhum item. */
  noMatch: string;
  /** Caixa somente leitura sem chips. */
  none: string;
  openLabel: string;
  closeLabel: string;
  saveLabel: string;
  cancelLabel: string;
  /** aria-label do campo de renomear um item. */
  renameFieldLabel: (name: string) => string;
};

export type ChipFieldProps = {
  label: string;
  items: ChipItem[];
  chips: ChipItem[];
  text: ChipFieldText;
  createLabel: (name: string) => string;
  removeLabel: (name: string) => string;
  renameLabel: (name: string) => string;
  onCreate?: (name: string) => SaveResult;
  onRename?: (item: ChipItem, name: string) => SaveResult;
  onRemoveChip?: (item: ChipItem) => void;
  onPick?: (item: ChipItem) => void;
  validate?: (name: string, exceptId?: string) => string;
  placeholder?: string;
  readOnly?: boolean;
  flashId?: string | null;
  busy?: boolean;
  /** A lista abre por cima do conteúdo, sem aumentar a altura de quem contém o campo. */
  floating?: boolean;
};

const BOX = "input h-auto min-h-10 w-full flex-wrap items-center gap-1 py-1";

export function ChipField({
  label,
  items,
  chips,
  text,
  createLabel,
  removeLabel,
  renameLabel,
  onCreate,
  onRename,
  onRemoveChip,
  onPick,
  validate,
  placeholder,
  readOnly = false,
  flashId,
  busy = false,
  floating = false,
}: ChipFieldProps) {
  const listId = useId();
  const inputId = useId();
  const errorId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState("");

  const search = searchChips(items, query, validate);
  const { error } = search;
  const options = onCreate
    ? search.options
    : search.options.filter((o) => o.kind === "item");
  const active =
    moved !== null && moved < options.length
      ? moved
      : defaultActive({ ...search, options }, query);
  const shownError = error || createError;

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
        {chips.map((c) => (
          <ChipFieldChip
            key={c.id}
            item={c}
            flashed={false}
            removeLabel={removeLabel}
          />
        ))}
        {chips.length === 0 ? (
          <span className="text-sm text-base-content/60">{text.none}</span>
        ) : null}
      </div>
    );

  const refocus = () => input.current?.focus();

  async function choose(o: ChipOption) {
    if (busy) return;
    if (o.kind === "create") {
      const message = await onCreate?.(o.name);
      if (message) {
        setCreateError(message);
        return;
      }
    } else onPick?.(o.item);
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
      setMoved(
        active < 0
          ? step === 1
            ? 0
            : options.length - 1
          : (active + step + options.length) % options.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0) void choose(options[active]);
    } else if (e.key === "Backspace" && query === "") {
      // Só foca o último x; excluir é uma decisão explícita.
      const xs =
        root.current?.querySelectorAll<HTMLButtonElement>("[data-chip-x]");
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

  async function save(item: ChipItem, name: string) {
    const message = await onRename?.(item, name);
    if (message) {
      setEditError(message);
      return;
    }
    setEditingId(null);
    refocus();
  }

  return (
    <div
      ref={root}
      onKeyDown={onRootKey}
      onBlur={onRootBlur}
      className="relative"
    >
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
        {chips.map((c) => (
          <ChipFieldChip
            key={c.id}
            item={c}
            flashed={flashId === c.id}
            disabled={busy}
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
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? errorId : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setMoved(null);
            setCreateError("");
            setOpen(true);
          }}
          onKeyDown={onInputKey}
        />
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle ml-auto"
          aria-label={open ? text.closeLabel : text.openLabel}
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
      {shownError ? (
        <small
          id={errorId}
          className="family-error label text-error whitespace-normal"
          role="alert"
        >
          {shownError}
        </small>
      ) : null}
      {open ? (
        <div
          className={floating ? "absolute inset-x-0 top-full z-20" : undefined}
        >
          <ChipFieldList
            id={listId}
            options={options}
            activeIndex={active}
            itemCount={items.length}
            chipIds={chips.map((c) => c.id)}
            editingId={editingId}
            canRename={Boolean(onRename)}
            busy={busy}
            editError={editError}
            validate={validate}
            text={{ ...text, createLabel, renameLabel }}
            onChoose={(o) => void choose(o)}
            onEdit={(item) => {
              setEditError("");
              setEditingId(item.id);
            }}
            onSave={(item, name) => void save(item, name)}
            onCancel={() => {
              setEditingId(null);
              refocus();
            }}
          />
        </div>
      ) : (
        <ul id={listId} role="listbox" hidden aria-label={text.list} />
      )}
    </div>
  );
}
