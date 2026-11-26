// Construtores PUROS de RowProps[]/segments da tela Mês: um por lista/gráfico,
// pela projeção (quando há) ou pelo modelo de itens do plano (fallback).
// Extraído de month-screen.tsx (Etapa 1). Ícone/cor de categoria sempre via
// app/month/palette.ts — nunca reimplementar a regra bill->Cartões aqui.
// O ícone React entra por `iconFor` (injetado pelo componente): sem JSX aqui,
// este arquivo e o model.ts rodam no node --test (que não carrega .tsx).
import type { ReactNode } from "react";
import type { RowProps } from "../ds/row.tsx";
import type { Currency } from "../../src/domain/finance.ts";
import { money } from "../lib/money.ts";
import type { MonthlyItem } from "../../src/server/routine.ts";
import type { MonthAnalysis } from "../month-analysis.ts";
import { pendingGaps, type ProjectionView } from "../projection-view.ts";
import { GAP_TITLE, gapHref } from "./copy.ts";
import { ddmm, toReais, toWholeReais } from "./format.ts";
import { categoryColor, flowCategory } from "./palette.ts";

export type IconFor = (name: string) => ReactNode;
export type FlowSegment = { value: number; color: string };
export type CategorySegment = { label: string; value: number; color: string };

// "O que vem" pela projeção: compromissos datados em aberto, já ordenados. Só
// até o fim do mês selecionado (o vencido continua: cai em hoje).
export function upcomingRows(
  pv: ProjectionView,
  month: string,
  colorByName: Map<string, number | null>,
  currency: Currency,
  iconFor: IconFor,
  hidden = false,
): RowProps[] {
  return pv.upcoming
    .filter((u) => u.date.slice(0, 7) <= month)
    .map((u) => ({
      icon: u.direction === "in" ? "↑" : iconFor(flowCategory(u) ?? u.label),
      tone: u.direction === "in" ? "ok" : "accent",
      // Mesma cor fixa da categoria usada em "Composição das saídas".
      catColor:
        u.direction === "in"
          ? undefined
          : categoryColor(flowCategory(u) ?? "", colorByName),
      title: u.label,
      sub: `${u.direction === "in" ? "entra" : "vence"} ${ddmm(u.date)}`,
      trail: {
        value: (u.direction === "in" ? "+" : "−") + money(u.cents, currency, hidden),
        tone: u.direction === "in" ? "ok" : undefined,
      },
      bordered: true,
    }));
}

// "Precisa de você" pela projeção: as lacunas que o motor classificou.
export function gapRows(gaps: ProjectionView["gaps"], currency: Currency, hidden = false): RowProps[] {
  return pendingGaps(gaps).map((g) => ({
    icon: "?",
    tone: "warn",
    title: g.kind === "other" ? g.reason || "Confira este valor" : GAP_TITLE[g.kind],
    sub:
      g.impactCents === "unbounded"
        ? "Sem isso, a gente não consegue calcular o mês."
        : `Pode mudar o saldo em ${money(g.impactCents, currency, hidden)}.`,
    bordered: true,
    href: gapHref(g.kind),
  }));
}

// "Vem aí" pelo modelo de itens (fallback sem projeção): em aberto, maior
// valor primeiro.
export function planOpenRows(
  items: MonthlyItem[],
  catById: Map<string, string>,
  currency: Currency,
  iconFor: IconFor,
  hidden = false,
): RowProps[] {
  return items
    .filter((i) => i.status !== "done" && !i.bank_cover && i.planned_cents !== null)
    .sort((x, y) => Number(BigInt(y.planned_cents!) - BigInt(x.planned_cents!)))
    .map((i) => {
      const catName = i.category_id ? catById.get(i.category_id) : null;
      const isIncome = i.purpose === "income";
      return {
        icon: iconFor(catName ?? i.label),
        tone: isIncome ? "ok" : "accent",
        title: i.label,
        sub: i.due_date ? `vence ${i.due_date.slice(8, 10)}` : undefined,
        trail: { value: money(i.planned_cents!, currency, hidden), tone: isIncome ? "ok" : undefined },
      } satisfies RowProps;
    });
}

// "Precisa de você" pelo modelo de itens (fallback sem projeção): vencidas
// primeiro (tom danger), depois itens sem valor que deixam o mês parcial.
export function planPendingRows(
  overdueItems: MonthlyItem[],
  unknownItems: MonthlyItem[],
  catById: Map<string, string>,
  currency: Currency,
  iconFor: IconFor,
  hidden = false,
): RowProps[] {
  return [
    ...overdueItems
      .slice()
      .sort((x, y) => Number(BigInt(y.planned_cents ?? "0") - BigInt(x.planned_cents ?? "0")))
      .map(
        (i) =>
          ({
            icon: "!",
            tone: "danger",
            solid: true,
            title: i.label,
            sub: i.due_date ? `venceu dia ${i.due_date.slice(8, 10)}` : "vencida",
            trail:
              i.planned_cents !== null
                ? { value: money(i.planned_cents, currency, hidden), tone: "danger" }
                : undefined,
            bordered: true,
          }) satisfies RowProps,
      ),
    ...unknownItems.map((i) => {
      const catName = i.category_id ? catById.get(i.category_id) : null;
      return {
        icon: iconFor(catName ?? i.label),
        tone: "warn",
        title: i.label,
        sub: "sem valor definido",
        bordered: true,
      } satisfies RowProps;
    }),
  ];
}

// "Seu mês" pela projeção: faixas a pagar / estimado (sem entradas — a barra
// é só a pendência de saída partida por confiança).
export function projectionFlowSegments(flow: ProjectionView["flow"]): FlowSegment[] {
  return [
    { value: Math.max(toWholeReais(flow.firmCents), 0), color: "var(--family-cat-6)" },
    { value: Math.max(toWholeReais(flow.estimatedCents), 0), color: "var(--family-warn)" },
  ].filter((s) => s.value > 0);
}

// Legenda de projectionFlowSegments: a pagar / estimado / entradas previstas.
export function projectionFlowRows(flow: ProjectionView["flow"], currency: Currency, hidden = false): RowProps[] {
  return [
    { sw: "var(--family-cat-6)", title: "A pagar", trail: money(flow.firmCents, currency, hidden), bordered: false },
    { sw: "var(--family-warn)", title: "Estimado", trail: { value: money(flow.estimatedCents, currency, hidden), tone: "warn" }, bordered: false },
    { sw: "var(--family-cat-4)", title: "Entradas previstas", trail: { value: money(flow.incomingCents, currency, hidden), tone: "ok" }, bordered: true },
  ];
}

// "Seu mês" pelo modelo de itens (fallback sem projeção): comprometido vs
// sobra (ou estouro).
export function planFlowSegments(a: MonthAnalysis): FlowSegment[] {
  const committed = (BigInt(a.committed) + BigInt(a.billsPaid)).toString();
  const leftoverCents = BigInt(a.leftover);
  const absLeftover = (leftoverCents < 0n ? -leftoverCents : leftoverCents).toString();
  return [
    { value: toReais(committed), color: "var(--family-cat-6)" },
    {
      value: Math.max(toWholeReais(absLeftover), 0),
      color: leftoverCents < 0n ? "var(--family-danger)" : "var(--family-lime)",
    },
  ];
}

// Legenda de planFlowSegments: entradas / saídas / sobra (ou estouro).
export function planFlowRows(a: MonthAnalysis, currency: Currency, hidden = false): RowProps[] {
  const leftoverCents = BigInt(a.leftover);
  const outflow = (BigInt(a.committed) + BigInt(a.billsPaid)).toString();
  return [
    { sw: "var(--family-success)", title: "Entradas", trail: { value: money(a.incomePlanned, currency, hidden), tone: "ok" }, bordered: false },
    { sw: "var(--family-cat-6)", title: "Saídas", trail: { value: money(outflow, currency, hidden) }, bordered: false },
    {
      sw: leftoverCents < 0n ? "var(--family-danger)" : "var(--family-lime)",
      title: leftoverCents < 0n ? "Estouro" : "Sobra prevista",
      trail: { value: money(a.leftover, currency, hidden), tone: leftoverCents < 0n ? "danger" : "ok" },
      bordered: false,
    },
  ];
}

// "Composição das saídas" por categoria, maior primeiro (peso em reais
// inteiros, só pra proporção visual) — pela projeção ou pelo plano.
export function compositionSegments(
  input:
    | { kind: "projection"; categories: ProjectionView["categories"] }
    | { kind: "plan"; items: MonthlyItem[]; catById: Map<string, string> },
  colorByName: Map<string, number | null>,
): CategorySegment[] {
  const entries: (readonly [string, number])[] =
    input.kind === "projection"
      ? input.categories.map((c) => [c.label, toWholeReais(c.cents)] as const)
      : (() => {
          const byCat = new Map<string, number>();
          for (const i of input.items) {
            if (i.purpose === "income" || i.planned_cents === null) continue;
            const key = (i.category_id && input.catById.get(i.category_id)) || i.label;
            byCat.set(key, (byCat.get(key) ?? 0) + toWholeReais(i.planned_cents));
          }
          return [...byCat.entries()];
        })();
  return entries.map(([label, value]) => ({ label, value, color: categoryColor(label, colorByName) }));
}
