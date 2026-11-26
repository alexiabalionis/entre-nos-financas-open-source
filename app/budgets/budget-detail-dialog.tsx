"use client";
import { Button } from "../button";
import { FamilyDialog } from "../dialogs/family-dialog";
import { Callout } from "../ds/callout";
import { StatusChip } from "../ds/status-chip";
import { monthTitle } from "../lib/dates.ts";
import { BudgetNums, verdictClass } from "./budget-summary";
import { BudgetBar } from "./budget-bar";
import { BudgetDetailSection } from "./budget-detail-section";
import { BudgetLegend } from "./budget-legend";
import { CategoryContext } from "./category-context";
import type { BudgetDetail } from "./budget-detail-model.ts";
import {
  STATE_VIEW,
  verdictText,
  type BudgetCardModel,
  type Money,
} from "./budget-view-model.ts";

/** O que compõe o gasto de uma categoria com teto. */
export function BudgetDetailDialog({
  card,
  detail,
  fmt,
  canEdit,
  onEdit,
  onClose,
}: {
  card: BudgetCardModel;
  detail: BudgetDetail;
  fmt: Money;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const view = STATE_VIEW[card.state];
  return (
    <FamilyDialog open title={card.name} busy={false} error="" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <StatusChip tone={view.tone} label={view.chip} />
          <span className="text-xs opacity-60">Teto {fmt(card.ceiling)}</span>
        </div>
        <p className={verdictClass(view.tone)} data-tone={view.tone}>
          {verdictText(card, fmt)}
        </p>
        <BudgetBar card={card} fmt={fmt} />
        <BudgetLegend />
        <BudgetNums
          items={[
            ["Teto", fmt(card.ceiling)],
            ["Já gastou", fmt(card.spent)],
            ["Ainda vai pagar", fmt(card.open)],
          ]}
        />
        <BudgetDetailSection
          title="Já gastou"
          total={card.spent}
          rows={detail.spentRows}
          done
          empty="Nada gasto ainda neste mês."
          fmt={fmt}
        />
        <BudgetDetailSection
          title="Ainda vai pagar"
          total={detail.upcomingTotal}
          rows={detail.upcomingRows}
          done={false}
          empty="Nada previsto para o resto do mês."
          fmt={fmt}
        />
        {detail.note ? (
          <Callout tone="accent" icon="i" title={detail.note.title}>
            {detail.note.body}
          </Callout>
        ) : (
          <p className="ds-caption">
            Uma conta paga e ligada ao banco conta uma vez só, pelo valor que
            saiu da conta.
          </p>
        )}
        <p className="ds-caption">
          O teto de {fmt(card.ceiling)} vale desde{" "}
          {monthTitle(card.from.slice(0, 7))} e segue valendo nos próximos meses
          até você mudar. Criar ou mudar uma conta fixa não muda o teto.
        </p>
        <CategoryContext name={card.name} canEdit={canEdit} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <Button variant="primary" onClick={onEdit}>
              Alterar o teto
            </Button>
          )}
          <Button variant="quiet" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </FamilyDialog>
  );
}
