"use client";
import { Button } from "../../ds/button";
import { Disclosure } from "../../ds/disclosure";
import { money } from "../../lib/money.ts";
import { OverviewChips } from "./overview-chips";
import { OverviewItemRow } from "./overview-item-row";
import { occurrenceTitle, occurrencesToggle } from "./overview-copy.ts";
import {
  frequentGroup,
  isEditable,
  occurrenceCents,
  occurrenceChips,
} from "./overview-model.ts";
import type { OverviewSeries } from "./overview-types.ts";

/**
 * Séries diárias e semanais: uma linha com o total do mês e, por baixo, cada
 * ocorrência. Editar só aparece para a ocorrência que o Mês também conhece.
 */
export function OverviewFrequentList({
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
  onEdit: ((itemId: string) => void) | null;
}) {
  return (
    <>
      {series.map((s) => {
        const group = frequentGroup(s, today);
        return (
          <div key={group.id} className="flex flex-col gap-1">
            <OverviewItemRow
              title={group.title}
              sub={group.sub}
              trail={money(group.totalCents, "BRL", hidden)}
              chips={<OverviewChips chips={group.chips} />}
            />
            <Disclosure summary={occurrencesToggle(group.occurrences.length)}>
              <div className="flex flex-col gap-2">
                {group.occurrences.map((o) => (
                  <OverviewItemRow
                    key={o.item_id}
                    title={occurrenceTitle(o.occurrence_date)}
                    trail={money(occurrenceCents(o), "BRL", hidden)}
                    chips={<OverviewChips chips={occurrenceChips(o, hidden)} />}
                  >
                    {onEdit && isEditable(o, editable) && (
                      <Button
                        variant="quiet"
                        size="sm"
                        icon="edit"
                        onClick={() => onEdit(o.item_id)}
                      >
                        Editar
                      </Button>
                    )}
                  </OverviewItemRow>
                ))}
              </div>
            </Disclosure>
          </div>
        );
      })}
    </>
  );
}
