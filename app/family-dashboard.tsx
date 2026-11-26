"use client";
import { useState } from "react";
import { categorySpending } from "../src/domain/dashboard.ts";
import { formatted } from "../src/domain/format.ts";
import type { Currency } from "../src/domain/finance.ts";
import type { EventRow } from "../src/server/state.ts";
import { eventName } from "../src/domain/event-name.ts";
import type { MonthlyItem } from "../src/server/routine.ts";
import { CategoryIcon } from "./family-categories";
import { Panel } from "./ds/panel.tsx";
import { Button } from "./ds/button.tsx";
const colors = [
  "#c5ab8b",
  "#7d9c91",
  "#b8806b",
  "#8f91b0",
  "#d0ba75",
  "#7295aa",
  "#bd91a3",
  "#8d9771",
];
export function SpendingPie({
  events,
  currency,
  hidden,
  items = [],
  categories = [],
  competenceSpending,
}: {
  events: EventRow[];
  currency: Currency;
  hidden: boolean;
  items?: MonthlyItem[];
  categories?: { id: string; name: string; fixed?: boolean }[];
  // Gasto por categoria pela competência (mês de vencimento da fatura do
  // cartão), mesma fonte do total do mês. Usado nas fatias e no total do modo
  // "registrado" para não divergir do orçamento; o detalhe por item segue a
  // timeline. Só preenchido em BRL; ausente/vazio cai no cálculo por data.
  competenceSpending?: { slices: { id: string; name: string; cents: string }[] };
}) {
  const [mode, setMode] = useState<"registered" | "planned">(() =>
    (competenceSpending?.slices.length ?? 0) > 0 ||
    categorySpending(events).total > 0n
      ? "registered"
      : "planned",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const entries =
    mode === "registered"
      ? events
          .filter((e) => e.currency === currency)
          .map((e) => ({ ...e, label: eventName(e) }))
      : items
          .filter(
            (i) =>
              ["expense", "benefit"].includes(i.purpose) &&
              i.currency === currency &&
              i.planned_cents !== null &&
              BigInt(i.planned_cents) > 0n,
          )
          .map((i) => ({
            id: i.id,
            label: i.label,
            kind: "expense" as const,
            amount_cents: (-BigInt(i.planned_cents!)).toString(),
            category_id: i.category_id,
            category_name:
              categories.find((c) => c.id === i.category_id)?.name ?? null,
          }));
  const plan = categorySpending(entries);
  // No modo "registrado" as fatias e o total vêm da competência (mesma fonte
  // do total do mês), não da soma por data em `entries`. O detalhe por item ao
  // clicar na categoria continua vindo da timeline (`entries`), por isso ele é
  // mantido. Sem competenceSpending (ex. moeda que não é BRL), cai no cálculo
  // por data. O modo "planejado" segue a soma do plano.
  const competenceSlices = (competenceSpending?.slices ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    cents: BigInt(s.cents),
  }));
  const { slices, adjustments, total } =
    mode === "registered" && competenceSpending
      ? {
          slices: competenceSlices,
          adjustments: plan.adjustments,
          total: competenceSlices.reduce((sum, s) => sum + s.cents, 0n),
        }
      : plan;
  let cursor = 0;
  const gradient = slices
    .map((r, i) => {
      const start = cursor;
      cursor += Number((r.cents * 1000000n) / total) / 10000;
      return `${colors[i % colors.length]} ${start}% ${i === slices.length - 1 ? 100 : cursor}%`;
    })
    .join(",");
  const details = selected
    ? entries.filter(
        (e) =>
          (e.category_id ?? "uncategorized") === selected &&
          ["expense", "fee", "card_purchase", "refund"].includes(e.kind),
      )
    : [];
  return (
    <div role="region" aria-label="Gastos por categoria" className="family-spending">
    <Panel title="Gastos por categoria">
      <div
        className="category-chart-tabs tabs tabs-box flex"
        role="group"
        aria-label="Origem dos valores do gráfico"
      >
        <button
          type="button"
          className={"tab flex-1" + (mode === "registered" ? " tab-active" : "")}
          aria-pressed={mode === "registered"}
          onClick={() => {
            setMode("registered");
            setSelected(null);
          }}
        >
          Registrados
        </button>
        <button
          type="button"
          className={"tab flex-1" + (mode === "planned" ? " tab-active" : "")}
          aria-pressed={mode === "planned"}
          onClick={() => {
            setMode("planned");
            setSelected(null);
          }}
        >
          Planejados
        </button>
      </div>
      <p className="ds-caption">
        {mode === "registered"
          ? "Consumo registrado no histórico deste mês. Prévias bancárias ficam de fora."
          : "Despesas previstas no plano do mês; não representam gastos realizados."}{" "}
        Transferências, câmbio, reservas e pagamentos de fatura ficam fora.
      </p>
      {hidden ? (
        <p className="ds-caption">
          Mostre os valores para ver o gráfico.
        </p>
      ) : !slices.length ? (
        <p className="ds-caption">
          {mode === "registered"
            ? "Ainda não há despesas registradas neste mês. Você pode consultar o planejamento acima."
            : "Ainda não há despesas planejadas com valor definido."}
        </p>
      ) : (
        <div className="family-pie-layout">
          <div
            className="family-pie"
            role="img"
            aria-label={`Gráfico unificado de gastos ${mode === "registered" ? "registrados" : "planejados"} por categoria; valores na legenda.`}
            style={{ background: `conic-gradient(${gradient})` }}
          >
            <span>
              <small>
                {mode === "registered" ? "Registrados" : "Planejados"}
              </small>
              <strong>{formatted(total.toString(), currency)}</strong>
            </span>
          </div>
          <ul className="family-pie-legend">
            {slices.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="category-legend-button btn btn-ghost h-auto"
                  aria-pressed={selected === r.id}
                  onClick={() => setSelected(selected === r.id ? null : r.id)}
                >
                  <span
                    className="category-symbol"
                    style={{ color: colors[i % colors.length] }}
                  >
                    <CategoryIcon name={r.name} />
                  </span>
                  <span>
                    {r.name}
                    <small>
                      {(
                        Number((r.cents * 1000n + total / 2n) / total) / 10
                      ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                      %
                    </small>
                  </span>
                  <strong>{formatted(r.cents.toString(), currency)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!hidden && selected && (
        <div className="category-details">
          <h3 className="text-sm font-semibold">{slices.find((s) => s.id === selected)?.name ?? "Categoria"}</h3>
          <ul className="list">
            {details.map((e) => (
              <li key={e.id} className="list-row px-0">
                <span className="list-col-grow text-sm font-medium">{e.label}</span>
                <strong className="text-sm font-medium tabular-nums">
                  {formatted(
                    (BigInt(e.amount_cents) < 0n
                      ? -BigInt(e.amount_cents)
                      : BigInt(e.amount_cents)
                    ).toString(),
                    currency,
                  )}
                  {e.kind === "refund" ? " · estorno" : ""}
                </strong>
              </li>
            ))}
          </ul>
          <Button variant="quiet" size="sm" onClick={() => setSelected(null)}>
            Fechar detalhes da categoria
          </Button>
        </div>
      )}
      {!hidden && adjustments.length > 0 && (
        <p className="ds-caption">
          Há reembolsos maiores que os gastos de algumas categorias. Eles ficam
          fora das fatias e continuam descontados das saídas.
        </p>
      )}
      <p className="ds-caption">
        Toque no ícone ou nome de uma categoria para ver seus itens.
        Planejamento e histórico ficam separados, sem somar uma conta duas
        vezes. Valores ainda sem categoria aparecem como “Sem categoria”.
      </p>
    </Panel>
    </div>
  );
}
