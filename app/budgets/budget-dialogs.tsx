"use client";
import type { Data } from "../hooks/use-month-data.ts";
import { budgetDetail } from "./budget-detail-model.ts";
import { BudgetDetailDialog } from "./budget-detail-dialog";
import { BudgetFormDialog } from "./budget-form-dialog";
import { BudgetRemoveDialog } from "./budget-remove-dialog";
import type { BudgetCardModel, Money } from "./budget-view-model.ts";
import type { useBudgetFlow } from "./use-budget-flow.ts";

type Currency = "BRL" | "USD" | "EUR";

/** Os diálogos do teto (detalhe, formulário, tirar), dirigidos pelo fluxo. */
export function BudgetDialogs({
  flow,
  data,
  cards,
  free,
  month,
  currency,
  hidden,
  reader,
  fmt,
}: {
  flow: ReturnType<typeof useBudgetFlow>;
  data: Data;
  cards: BudgetCardModel[];
  free: { id: string; name: string }[];
  month: string;
  currency: Currency;
  hidden: boolean;
  reader: boolean;
  fmt: Money;
}) {
  const { events, accounts, spendingLines } = data.state;
  const opened = cards.find((c) => c.id === flow.detailId);
  const items = data.routine.items.filter((i) => i.currency === currency);
  return (
    <>
      {flow.view === "detail" && opened && (
        <BudgetDetailDialog
          card={opened}
          detail={budgetDetail({
            categoryId: opened.id,
            currency,
            spent: opened.spent,
            events,
            lines: spendingLines,
            accounts,
            items,
            fmt,
          })}
          fmt={fmt}
          canEdit={!reader}
          onEdit={() => flow.openForm(opened.id)}
          onClose={flow.close}
        />
      )}
      {flow.view === "form" && (
        <BudgetFormDialog
          draft={flow.draft}
          card={flow.card}
          name={flow.name}
          free={free}
          month={month}
          currency={currency}
          hidden={hidden}
          fmt={fmt}
          showError={flow.showError}
          busy={flow.action.busy}
          error={flow.action.error}
          onEdit={flow.edit}
          onSave={flow.save}
          onRemove={flow.openRemove}
          onClose={flow.close}
        />
      )}
      {flow.view === "remove" && flow.card && (
        <BudgetRemoveDialog
          card={flow.card}
          name={flow.name}
          from={flow.draft.from}
          month={month}
          fmt={fmt}
          busy={flow.action.busy}
          error={flow.action.error}
          onConfirm={flow.remove}
          onBack={flow.backToForm}
        />
      )}
    </>
  );
}
