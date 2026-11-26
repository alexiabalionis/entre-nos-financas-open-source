"use client";
import { Button } from "../../ds/button";
import { money } from "../../lib/money.ts";
import { isEditable, seriesRow } from "./overview-model.ts";
import { OverviewItemRow } from "./overview-item-row";
import type { OverviewSeries } from "./overview-types.ts";

/**
 * Contas que caem uma vez por período: mensais, anuais e as que só aparecem em
 * outros meses. "Editar" abre o menu da conta pela ocorrência deste mês; sem
 * ela aqui, abre pela próxima ocorrência aberta, no mês dela.
 */
export function OverviewSeriesList({
  series,
  today,
  hidden,
  editable,
  onEdit,
}: {
  series: OverviewSeries[];
  today: string;
  hidden: boolean;
  editable: ReadonlySet<string>;
  onEdit: ((itemId: string, month?: string) => void) | null;
}) {
  return (
    <>
      {series.map((s) => {
        const row = seriesRow(s, today, hidden);
        const here = s.occurrences.find((o) => isEditable(o, editable));
        const target = here
          ? { itemId: here.item_id, month: undefined }
          : s.next_item
            ? { itemId: s.next_item.item_id, month: s.next_item.month }
            : null;
        return (
          <OverviewItemRow
            key={row.id}
            title={row.title}
            sub={row.sub}
            trail={money(row.cents, "BRL", hidden)}
          >
            {onEdit && target && (
              <Button
                variant="quiet"
                size="sm"
                icon="edit"
                onClick={() => onEdit(target.itemId, target.month)}
              >
                Editar
              </Button>
            )}
          </OverviewItemRow>
        );
      })}
    </>
  );
}
