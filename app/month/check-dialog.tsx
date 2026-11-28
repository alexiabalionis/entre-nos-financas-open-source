"use client";
import { Button } from "../ds/button.tsx";
import { Select } from "../ds/select";
import { FamilyDialog } from "../dialogs/family-dialog";
import { api } from "../lib/api.ts";
import { formValues } from "../lib/form.ts";
import { today } from "../lib/dates.ts";
import { plainMoney, brDate } from "../../src/domain/format.ts";
import type { Action } from "../hooks/use-action.ts";
import type { MonthItem } from "../hooks/use-month-data.ts";

/** "Atualizar compromisso": marca o item do mês como pago/recebido. */
export function CheckDialog({
  open,
  selected,
  action,
  onClose,
  onSaved,
}: {
  open: boolean;
  selected: MonthItem | null;
  action: Action;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { busy } = action;
  return (
    <FamilyDialog
      open={open}
      title="Atualizar compromisso"
      busy={busy}
      error={action.error}
      onClose={onClose}
    >
      {selected && (
        <form
          key={selected.id}
          onSubmit={(e) => {
            const v = formValues(e);
            void action.work(async () => {
              await api("routine/check", {
                ...v,
                id: selected.id,
                version: selected.version,
                amount: v.amount || null,
                date: v.date || null,
                event_id: v.event_id || null,
              });
              onClose();
              await onSaved();
            });
          }}
        >
          <p>
            <strong>{selected.label}</strong>
          </p>
          <label>
            Como está?
            <Select
              name="status"
              defaultValue={selected.status === "done" ? "open" : "done"}
            >
              <option value="done">
                {selected.purpose === "income" ? "Recebido" : "Pago / reservado"}
              </option>
              <option value="partial">
                {selected.purpose === "income"
                  ? "Recebido em parte"
                  : "Pago parcialmente"}
              </option>
              <option value="open">Em aberto</option>
            </Select>
          </label>
          <label>
            Valor realizado (opcional)
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={
                selected.paid_cents
                  ? plainMoney(selected.paid_cents)
                  : selected.planned_cents
                    ? plainMoney(selected.planned_cents)
                    : ""
              }
              placeholder="0,00"
            />
          </label>
          <label>
            Data (opcional)
            <input
              type="date"
              name="date"
              defaultValue={selected.paid_date ?? today()}
            />
          </label>
          {selected.candidates.length > 0 && (
            <>
              <label>
                Vincular a movimento do Extrato
                <Select name="event_id" defaultValue={selected.event_id ?? ""}>
                  <option value="">Apenas marcar no plano (sem vincular)</option>
                  {selected.candidates.map((e) => (
                    <option key={e.id} value={e.id}>
                      {brDate(e.transaction_date)} · {e.name.slice(0, 75)}
                    </option>
                  ))}
                </Select>
              </label>
              {!selected.event_id && selected.candidates.length === 1 && (
                <p className="ds-caption">
                  Encontramos 1 movimento parecido no Extrato — selecione acima para marcar como contabilizado.
                </p>
              )}
            </>
          )}
          <p className="ds-caption">
            Vincular liga este item ao lançamento real do Extrato, sem contar duas vezes.
          </p>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            busyLabel="Salvando…"
          >
            Atualizar compromisso
          </Button>
        </form>
      )}
    </FamilyDialog>
  );
}
