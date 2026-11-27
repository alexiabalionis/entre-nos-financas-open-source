"use client";
// Para onde vai o dinheiro: lugares com vezes, média, última e total.
import { useState } from "react";
import { Panel } from "../ds/panel.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { brDate } from "../../src/domain/format.ts";
import { ChoiceChips } from "./choice-chips.tsx";
import { placesReading, sortPlaces, type Money, type PlaceOrder, type PlacePeriod } from "./model.ts";

const PERIODS = [["quarter", "3 meses"], ["year", "Ano"]] as const;
const ORDERS = [["visits", "Vezes"], ["average", "Média"], ["last", "Última"], ["total", "Total"]] as const;
const LIMIT = 15;

export function PlacesPanel({ data, money }: { data: InsightsWire; money: Money }) {
  const [period, setPeriod] = useState<PlacePeriod>("quarter");
  const [order, setOrder] = useState<PlaceOrder>("visits");
  const list = data.places[period];
  const sorted = sortPlaces(list, order).slice(0, LIMIT);
  const total = list.reduce((a, p) => a + BigInt(p.total), 0n);
  const third = order === "visits" ? "average" : order;
  const value = (p: (typeof list)[number]) =>
    third === "last" ? brDate(p.last).slice(0, 5) : money(BigInt(third === "average" ? p.average : p.total));
  const reading = placesReading(list, money);
  return (
    <Panel title="Para onde vai o dinheiro">
      <p className="text-[0.875rem] text-ink-2 tabular-nums">
        {list.length} lugares · {money(total)} {period === "year" ? "no último ano" : "nos últimos 3 meses"}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChoiceChips label="Período" options={PERIODS} value={period} onChange={setPeriod} />
        <ChoiceChips label="Ordenar por" options={ORDERS} value={order} onChange={setOrder} />
      </div>
      {sorted.length === 0 ? (
        <p className="text-[0.875rem] text-ink-2">Nenhum gasto no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[0.75rem] font-medium uppercase tracking-wider text-ink-2">
                <th className="py-2 pr-3 font-medium">Lugar</th>
                <th className="py-2 px-3 text-right font-medium">Vezes</th>
                <th className="py-2 pl-3 text-right font-medium">
                  {{ average: "Média", last: "Última", total: "Total" }[third]}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[0.9375rem]">
              {sorted.map((p) => (
                <tr key={p.merchant} className="transition-colors hover:bg-surface-2/60">
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    <span>{p.label}</span>
                    {p.category && (
                      <small className="block text-[0.75rem] font-normal text-ink-2">
                        {p.category}
                      </small>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-ink-2 tabular-nums">{p.visits}</td>
                  <td className="py-2.5 pl-3 text-right font-medium text-ink tabular-nums">
                    {value(p)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reading && (
        <p className="text-[0.875rem] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">{reading}</strong>
        </p>
      )}
    </Panel>
  );
}
