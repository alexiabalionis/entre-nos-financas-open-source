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
      <p className="ins-sub">
        {list.length} lugares · {money(total)} {period === "year" ? "no último ano" : "nos últimos 3 meses"}
      </p>
      <ChoiceChips label="Período" options={PERIODS} value={period} onChange={setPeriod} />
      <ChoiceChips label="Ordenar por" options={ORDERS} value={order} onChange={setOrder} />
      {sorted.length === 0 ? (
        <p className="ds-caption">Nenhum gasto no período.</p>
      ) : (
        <table className="ins-table">
          <thead>
            <tr>
              <th>Lugar</th>
              <th>Vezes</th>
              <th>{{ average: "Média", last: "Última", total: "Total" }[third]}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.merchant}>
                <td>
                  {p.label}
                  {p.category && <small>{p.category}</small>}
                </td>
                <td>{p.visits}</td>
                <td>{value(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reading && (
        <p className="ds-caption">
          <b>{reading}</b>
        </p>
      )}
    </Panel>
  );
}
