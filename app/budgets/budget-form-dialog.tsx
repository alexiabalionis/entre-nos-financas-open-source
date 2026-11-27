"use client";
import { Select } from "../ds/select";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import { FieldError } from "../fixed/field-error";
import { monthTitle } from "../lib/dates.ts";
import {
  CEILING_ERROR,
  ceilingInput,
  fromOptions,
  removeLabel,
  validFromText,
  type BudgetDraft,
} from "./budget-form-model.ts";
import { BudgetReference } from "./budget-reference";
import type { BudgetCardModel, Money } from "./budget-view-model.ts";

/** Definir ou alterar o teto, com "Vale a partir de" e erro no próprio campo. */
export function BudgetFormDialog({
  draft,
  card,
  name,
  free,
  month,
  currency,
  hidden,
  fmt,
  showError,
  busy,
  error,
  onEdit,
  onSave,
  onRemove,
  onClose,
}: {
  draft: BudgetDraft;
  card: BudgetCardModel | null;
  name: string;
  free: { id: string; name: string }[];
  month: string;
  currency: string;
  hidden: boolean;
  fmt: Money;
  showError: boolean;
  busy: boolean;
  error: string;
  onEdit: (patch: Partial<BudgetDraft>) => void;
  onSave: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <FamilyDialog
      open
      title={card ? `Teto de ${name}` : "Definir um teto"}
      busy={busy}
      error={error}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        {card ? (
          <div>
            <p className="ds-caption">Categoria</p>
            <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-ink">
              {name}
            </div>
            <p className="ds-caption">
              Hoje o teto é {fmt(card.ceiling)} e vale desde{" "}
              {monthTitle(card.from.slice(0, 7))}.
            </p>
          </div>
        ) : (
          <label>
            Categoria
            <Select
              name="category"
              value={draft.categoryId}
              onChange={(e) => onEdit({ categoryId: e.target.value })}
            >
              {free.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {currency === "BRL" && draft.categoryId && (
          <BudgetReference
            categoryId={draft.categoryId}
            month={month}
            fmt={fmt}
            hidden={hidden}
            onUse={(cents) => onEdit({ value: ceilingInput(cents) })}
          />
        )}
        <label>
          Quanto pode gastar por mês
          <input
            name="value"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Ex.: 1.800,00"
            value={draft.value}
            aria-invalid={showError || undefined}
            aria-describedby="budget-value-error"
            onChange={(e) => onEdit({ value: e.target.value })}
          />
        </label>
        <FieldError
          id="budget-value-error"
          text={showError ? CEILING_ERROR : undefined}
        />
        <label>
          Vale a partir de
          <Select
            name="from"
            value={draft.from}
            onChange={(e) => onEdit({ from: e.target.value })}
          >
            {fromOptions(month).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <p className="text-sm text-success" role="status">
          {validFromText(draft.from, month, card ? fmt(card.ceiling) : null)}
        </p>
        <p className="ds-caption">
          Criar ou mudar uma conta fixa nunca muda o teto. Ele só muda aqui.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="primary" type="submit" disabled={busy}>
            Salvar teto
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
        </div>
        {card && (
          <div>
            <Button variant="text" disabled={busy} onClick={onRemove}>
              {removeLabel(draft.from, month)}
            </Button>
          </div>
        )}
      </form>
    </FamilyDialog>
  );
}
