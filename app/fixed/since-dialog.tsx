"use client";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { monthTitle } from "../lib/dates.ts";
import type { SeriesItem } from "./fixed-status.ts";
import { plural } from "./preview-model.ts";

/** "Desde quando": a conta fixa já valia antes; os meses que faltam entram como pagos. */
export function SinceDialog({
  item,
  action,
  onBack,
  onDone,
}: {
  item: SeriesItem;
  action: Action;
  onBack: () => void;
  onDone: (message: string) => void;
}) {
  const startMonth = item.recurrence.start_date.slice(0, 7);
  const [month, setMonth] = useState("");
  const [tried, setTried] = useState(false);
  const error = !/^\d{4}-\d{2}$/.test(month)
    ? "Escolha o mês."
    : month >= startMonth
      ? `Escolha um mês antes de ${monthTitle(startMonth)}.`
      : "";
  const showError = tried && error !== "";

  const confirm = () => {
    setTried(true);
    if (error) return;
    void action.work(async () => {
      const { created } = await api<{ created: number }>("recurrences/since", {
        recurrence_id: item.recurrence.id,
        since_month: month,
      });
      onDone(
        `${item.label} agora vale desde ${monthTitle(month)}. ${created} ${plural(created, "mês entrou", "meses entraram")} no plano.`,
      );
    });
  };

  return (
    <FamilyDialog open title="Desde quando é fixa" busy={action.busy} error={action.error} onClose={onBack}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
        noValidate
      >
        <p className="ds-caption">
          Hoje {item.label} começa em {monthTitle(startMonth)}. Os meses anteriores entram como pagos, com o mesmo valor. Se houver um pagamento parecido no mês, ele fica ligado à conta e o gasto conta uma vez.
        </p>
        <label>
          Já era fixa desde
          <input
            name="since_month"
            type="month"
            max={startMonth}
            value={month}
            aria-invalid={showError}
            aria-describedby="since-error"
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        {showError && (
          <p className="text-error text-sm" id="since-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Salvar
          </Button>
          <Button variant="quiet" disabled={action.busy} onClick={onBack}>
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
