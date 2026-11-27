"use client";
import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import type { Currency } from "../../src/domain/finance.ts";
import { Panel } from "../ds/panel.tsx";
import { PlanGroup } from "./plan-group.tsx";
import { PLAN_GROUPS, type PlanGroupId } from "./plan-model.ts";

/**
 * Zona 3 (esquerda): consolida Entradas, Custos fixos, Custos variáveis e
 * Reservas dentro de um único painel limpo com grupos expansíveis.
 */
export function PlanSection({
  items,
  categories,
  events,
  currency,
  hidden,
  today,
  busy,
  reader,
  onCheck,
  onOpenItem,
  onAddGroup,
}: {
  items: MonthItem[];
  categories: Data["state"]["categories"];
  events: Data["state"]["events"];
  currency: Currency;
  hidden: boolean;
  today: string;
  busy: boolean;
  reader: boolean;
  onCheck: (item: MonthItem) => void;
  onOpenItem: (item: MonthItem) => void;
  onAddGroup: (groupId: PlanGroupId) => void;
}) {
  const countLabel =
    items.length === 1 ? "1 item no plano" : `${items.length} itens no plano`;

  return (
    <Panel title="Plano do mês" meta={countLabel} className="mb-0">
      <div className="flex flex-col divide-y divide-border">
        {PLAN_GROUPS.map((group) => (
          <PlanGroup
            key={group.id}
            flat
            group={group}
            items={items}
            categories={categories}
            events={events}
            currency={currency}
            hidden={hidden}
            today={today}
            busy={busy}
            reader={reader}
            onCheck={onCheck}
            onOpenItem={onOpenItem}
            onAdd={() => onAddGroup(group.id)}
          />
        ))}
      </div>
    </Panel>
  );
}
