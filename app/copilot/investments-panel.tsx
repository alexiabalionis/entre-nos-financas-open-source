"use client";
// Investimentos em formato compacto (GET investments).
import { Panel } from "../ds/panel.tsx";
import { RowList } from "../ds/row-list.tsx";
import { brDate } from "../../src/domain/format.ts";
import { CategoryIcon } from "../family-categories.tsx";
import type { Investments } from "../hooks/use-copilot.ts";
import type { Money } from "./money.ts";

export function InvestmentsPanel({ data, money }: { data: Investments | null; money: Money }) {
  const positions = (data?.positions ?? []).filter((p) => p.currency === "BRL");
  if (!positions.length) return null;
  return (
    <Panel title="Investimentos">
      <RowList
        rows={positions.map((p) => {
          const value = p.observed_cents ?? p.calculated_cents;
          return {
            icon: <CategoryIcon name="Rendimentos" />,
            tone: "accent",
            title: p.name,
            sub: p.observed_date
              ? `extrato de ${brDate(p.observed_date)}`
              : value !== null
                ? "calculado pelos lançamentos"
                : "saldo a completar",
            trail: value !== null ? money(BigInt(value)) : undefined,
          };
        })}
      />
    </Panel>
  );
}
