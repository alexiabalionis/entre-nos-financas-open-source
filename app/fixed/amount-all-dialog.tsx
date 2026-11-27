"use client";
import { useState } from "react";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { plainMoney } from "../../src/domain/format.ts";
import type { SeriesItem } from "./fixed-status.ts";
import { newAmount, plural } from "./preview-model.ts";

/** "Todas": novo valor para todos os meses da conta fixa, também os anteriores. */
export function AmountAllDialog({
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
  const [text, setText] = useState(item.planned_cents ? plainMoney(item.planned_cents) : "");
  const [tried, setTried] = useState(false);
  const amount = newAmount(text);
  const showError = tried && "error" in amount;

  const confirm = () => {
    setTried(true);
    if (!("cents" in amount)) return;
    void action.work(async () => {
      const { updated } = await api<{ updated: number }>("recurrences/amount-all", {
        recurrence_id: item.recurrence.id,
        expected_cents: amount.cents,
      });
      onDone(
        `Pronto. ${updated} ${plural(updated, "mês atualizado", "meses atualizados")}. Meses com pagamento real ou pagos com outro valor ficaram como estavam.`,
      );
    });
  };

  return (
    <FamilyDialog open title="Todas" busy={action.busy} error={action.error} onClose={onBack}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
        noValidate
      >
        <p className="ds-caption">
          Muda o valor de {item.label} em todos os meses, também nos anteriores. Meses ligados a um pagamento real continuam com o valor pago.
        </p>
        <label>
          Novo valor
          <input
            name="amount"
            inputMode="decimal"
            value={text}
            aria-invalid={showError}
            aria-describedby="amount-all-error"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {showError && (
          <p className="text-sm text-danger" id="amount-all-error" role="alert">
            {amount.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Atualizar todas
          </Button>
          <Button variant="quiet" disabled={action.busy} onClick={onBack}>
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
