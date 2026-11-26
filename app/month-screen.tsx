"use client";
// Tela "Mês" NOVA e ISOLADA: vitrine funcional da aba Mês com os primitivos
// do DS (app/ds) + CategoryIcon + formatted. NÃO plugada em produção, NÃO
// toca family.tsx. A lógica (análise do mês, projeção-vs-plano, linhas e
// segmentos) mora em app/month/ (Etapa 1); a apresentação é um componente
// por bloco em app/month/blocks/ (Etapa 2) — este componente só chama
// buildMonthModel e monta saudação + Stepper + HeroBlock (fixo) + os blocos
// do registry, na ordem de MONTH_BLOCK_ORDER.
import type { Currency } from "../src/domain/finance.ts";
import type { MonthlyItem } from "../src/server/routine.ts";
import { MonthHeader, type MonthHeaderPerson } from "./month/blocks/month-header.tsx";
import type { ProjectionMode, ProjectionView } from "./projection-view.ts";
import { monthLabel } from "./month/format.ts";
import { buildMonthModel, type Category } from "./month/model.ts";
import { categoryIconFor } from "./month/blocks/category-icon-for.tsx";
import { HeroBlock } from "./month/blocks/hero-block.tsx";
import { MONTH_BLOCKS, MONTH_BLOCK_ORDER } from "./month/blocks/registry.ts";


type MonthScreenProps = {
  items: MonthlyItem[];
  categories: Category[];
  month: string;
  currency: Currency;
  onMoveMonth: (month: string) => void;
  /** Pessoas da saudação do cabeçalho ("Oi, A e B"). Pelo menos uma — a
   *  pessoa logada, no mínimo. */
  people: MonthHeaderPerson[];
  /** Saldo total das contas (centavos), pro bloco "Caminho do saldo".
   *  Ausente/null: placeholder honesto, sem inventar projeção. */
  balanceCents?: string | null;
  /** Projeção de caixa (motor F0 via F1): presente, herói/"Seu mês"/"O que
   *  vem" saem dela; ausente, cai no modelo de itens (fallback até o F1). */
  projection?: ProjectionView | null;
  /** Modo da projeção do mês pedido (default 'current'); closed usa o
   *  modelo de itens, unavailable só mostra aviso. */
  mode?: ProjectionMode;
  /** Palavra de estado do servidor; presente, vira a legenda do seletor. */
  statusWord?: string;
};

export function MonthScreen({
  items,
  categories,
  month,
  currency,
  onMoveMonth,
  people,
  balanceCents,
  projection,
  mode = "current",
  statusWord,
}: MonthScreenProps) {
  const model = buildMonthModel({
    items,
    categories,
    month,
    currency,
    balanceCents,
    projection,
    mode,
    iconFor: categoryIconFor,
  });
  return (
    <div className="ds-list ds-stagger">
      <MonthHeader
        people={people}
        label={monthLabel(month)}
        caption={statusWord ?? model.defaultStepperCaption}
        prevLabel="Mês anterior"
        nextLabel="Próximo mês"
        onPrev={() => onMoveMonth(model.prevMonth)}
        onNext={() => onMoveMonth(model.nextMonth)}
      />
      <HeroBlock model={model} currency={currency} />

      {MONTH_BLOCK_ORDER.map((id) => {
        const { Component } = MONTH_BLOCKS[id];
        return <Component key={id} model={model} currency={currency} />;
      })}
    </div>
  );
}
