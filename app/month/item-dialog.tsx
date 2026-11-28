"use client";
import { Button } from "../ds/button.tsx";
import { Select } from "../ds/select";
import { useState } from "react";
import { FamilyDialog } from "../dialogs/family-dialog";
import { CategoryPicker } from "../family-categories";
import { LegacyFixedLink } from "../fixed/legacy-fixed-link";
import { isLegacyFixed } from "../fixed/fixed-status.ts";
import { api } from "../lib/api.ts";
import { formValues } from "../lib/form.ts";
import { moveMonth } from "../lib/dates.ts";
import { money } from "../lib/money.ts";
import { plainMoney } from "../../src/domain/format.ts";
import type { Action } from "../hooks/use-action.ts";
import type { Data, MonthItem } from "../hooks/use-month-data.ts";

const purposes: Record<string, string> = {
  expense: "Conta a pagar",
  income: "Entrada prevista",
  card: "Fatura",
  saving: "Reserva ou objetivo",
  benefit: "Pago com benefício",
};

type ItemFormProps = {
  selected: MonthItem | null;
  initialPurpose: string;
  initialCostType: string;
  month: string;
  currency: string;
  categories: Data["state"]["categories"];
  reader: boolean;
  hidden: boolean;
  action: Action;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

/** "Planejar um compromisso" / "Ajustar nosso plano" do Mês. */
export function ItemDialog({
  open,
  ...form
}: ItemFormProps & { open: boolean }) {
  return (
    <FamilyDialog
      open={open}
      title={form.selected ? "Ajustar nosso plano" : "Planejar um compromisso"}
      busy={form.action.busy}
      error={form.action.error}
      onClose={form.onClose}
    >
      <ItemForm key={form.selected?.id ?? "new"} {...form} />
    </FamilyDialog>
  );
}

function ItemForm({
  selected,
  initialPurpose,
  initialCostType,
  month,
  currency,
  categories,
  reader,
  hidden,
  action,
  onClose,
  onSaved,
}: ItemFormProps) {
  const [itemPurpose, setItemPurpose] = useState(
    selected?.purpose ?? initialPurpose,
  );
  const { busy } = action;
  return (
    <form
      onSubmit={(e) => {
        const v = formValues(e);
        void action.work(async () => {
          await api("routine/item", {
            ...v,
            ...(selected ? { id: selected.id, version: selected.version } : {}),
            month,
            currency: selected?.currency ?? currency,
            category_id:
              v.category_id === undefined
                ? (selected?.category_id ?? null)
                : v.category_id || null,
            due_date: v.due_date || null,
            cost_type:
              ["expense", "card", "benefit"].includes(itemPurpose) &&
              v.cost_type !== "auto"
                ? v.cost_type
                : null,
          });
          onClose();
          await onSaved();
        });
      }}
    >
      <label>
        O que vamos planejar?
        <input
          name="label"
          defaultValue={selected?.label}
          required
          maxLength={180}
          placeholder={
            itemPurpose === "income"
              ? "Ex.: salário, trabalho extra…"
              : "Ex.: energia de casa…"
          }
        />
      </label>
      <label>
        Tipo
        <Select
          name="purpose"
          value={itemPurpose}
          onChange={(e) => setItemPurpose(e.target.value)}
          disabled={!!selected}
        >
          {Object.entries(purposes).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {selected && (
          <input type="hidden" name="purpose" value={selected.purpose} />
        )}
      </label>
      {["expense", "card", "benefit"].includes(itemPurpose) && (
        <label>
          Como aparece no mês
          <Select
            name="cost_type"
            defaultValue={selected?.cost_type ?? initialCostType}
          >
            <option value="auto">Sugerir pelo nome da conta</option>
            <option value="fixed">Custo fixo · compromisso recorrente</option>
            <option value="variable">
              Custo variável · gasto que varia
            </option>
          </Select>
        </label>
      )}
      <label>
        Valor previsto ({selected?.currency ?? currency})
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={
            selected?.planned_cents ? plainMoney(selected.planned_cents) : ""
          }
          placeholder="0,00"
        />
      </label>
      <label>
        Vencimento (opcional)
        <input
          name="due_date"
          type="date"
          min={month + "-01"}
          max={moveMonth(month, 1) + "-01"}
          defaultValue={selected?.due_date ?? ""}
        />
      </label>
      {["expense", "benefit"].includes(selected?.purpose ?? itemPurpose) && (
        <CategoryPicker
          categories={categories}
          value={selected?.category_id}
        />
      )}
      {selected && isLegacyFixed(selected) && <LegacyFixedLink />}
      <label>
        Observações
        <textarea
          name="notes"
          maxLength={1000}
          defaultValue={selected?.notes}
        />
      </label>
      {selected?.source_note && (
        <p className="ds-caption">Na planilha: {selected.source_note}</p>
      )}
      {selected?.actual_reference_cents && (
        <p className="ds-caption">
          Valor de referência da planilha:{" "}
          {money(selected.actual_reference_cents, selected.currency, hidden)}.
          Não gera um novo movimento.
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        busy={busy}
        busyLabel="Salvando…"
        disabled={reader}
      >
        Salvar no nosso mês
      </Button>
    </form>
  );
}
