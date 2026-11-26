"use client";
// Faturas futuras em formato compacto (GET cards/projection).
import { Panel } from "../ds/panel.tsx";
import { RowList } from "../ds/row-list.tsx";
import { monthLabel } from "../month/format.ts";
import { CategoryIcon } from "../family-categories.tsx";
import type { CardProjection } from "../hooks/use-copilot.ts";
import type { Money } from "./money.ts";

const SOURCE = { bank: "informado pelo banco", cycle: "estimado", partial: "parcial" } as const;

export function BillsPanel({ data, money }: { data: CardProjection | null; money: Money }) {
  const rows = (data?.cards ?? []).flatMap((card) =>
    card.months.map((bill) => ({
      icon: <CategoryIcon name="Cartão" />,
      tone: "accent" as const,
      title: card.name,
      sub: `vence em ${monthLabel(bill.due_month).toLowerCase()} · ${SOURCE[bill.source]}`,
      trail: money(BigInt(bill.total_cents)),
    })),
  );
  if (!rows.length) return null;
  return (
    <Panel title="Faturas futuras" meta="estimado">
      <RowList rows={rows} />
    </Panel>
  );
}
