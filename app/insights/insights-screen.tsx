"use client";
// Panorama: o que a casa ganha, guarda e gasta, e para onde vai. Três partes
// (Entradas e saídas, Gastos, Onde vai); cada bloco termina com uma leitura
// curta. É a aba Panorama do menu (substituiu a antiga aba Futuro).
import { useState } from "react";
import { Button } from "../button.tsx";
import type { Category } from "../month/model.ts";
import { moneyOf } from "../copilot/money.ts";
import { monthTitle } from "../lib/dates.ts";
import { useInsights } from "../hooks/use-insights.ts";
import { ChoiceChips } from "./choice-chips.tsx";
import { SummaryCards } from "./summary-cards.tsx";
import { InOutPanel } from "./in-out-panel.tsx";
import { BalancePanel } from "./balance-panel.tsx";
import { CategoryPanel } from "./category-panel.tsx";
import { FixedPanel } from "./fixed-panel.tsx";
import { DaysPanel } from "./days-panel.tsx";
import { PlacesPanel } from "./places-panel.tsx";

type Tab = "io" | "spend" | "places";
const TABS = [["io", "Entradas e saídas"], ["spend", "Gastos"], ["places", "Onde vai"]] as const;

export function InsightsScreen({
  month,
  hidden,
  categories,
}: {
  month: string;
  hidden: boolean;
  categories: Category[];
}) {
  const [tab, setTab] = useState<Tab>("io");
  const { data, error, reload, refreshing, updatedAt } = useInsights(month);
  const money = moneyOf(hidden);
  const colorByName = new Map(categories.map((c) => [c.name, c.colorIndex ?? null]));
  return (
    <div className="ds-list ins-screen">
      <ChoiceChips label="Parte do panorama" options={TABS} value={tab} onChange={setTab} />
      {error && (
        <p role="alert" className="ds-caption alert alert-soft alert-error">
          {error}{" "}
          <Button variant="text" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </p>
      )}
      {!data && !error && (
        <p role="status" className="ds-caption alert alert-soft alert-info">
          Carregando o panorama…
        </p>
      )}
      {data && (
        <p className="ins-fresh" role="status" data-busy={refreshing || undefined}>
          <span className="ins-fresh-dot" aria-hidden="true" />
          {refreshing ? "atualizando…" : freshLabel(data, month, updatedAt)}
        </p>
      )}
      {data && (
        // A chave troca com a aba: o conteúdo novo entra subindo (ds-stagger).
        // Uma releitura dos dados não troca a chave; só os números e as barras mudam.
        <div key={tab} className="ds-list ds-stagger">
          {tab === "io" && (
            <>
              <SummaryCards data={data} hidden={hidden} />
              <InOutPanel data={data} money={money} hidden={hidden} colorByName={colorByName} />
              <BalancePanel data={data} money={money} hidden={hidden} />
            </>
          )}
          {tab === "spend" && (
            <>
              <CategoryPanel data={data} money={money} hidden={hidden} colorByName={colorByName} />
              <FixedPanel data={data} money={money} />
              <DaysPanel data={data} money={money} hidden={hidden} />
            </>
          )}
          {tab === "places" && <PlacesPanel data={data} money={money} />}
        </div>
      )}
    </div>
  );
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * De quando são os dados, em voz baixa. Mês atual: "atualizado às 11:46".
 * Mês passado: "como estava em 31/08". Mês futuro: ainda não há lançamentos.
 */
function freshLabel(
  data: { today: string; current: boolean; future: boolean },
  month: string,
  at: Date | null,
): string {
  const day = `${data.today.slice(8, 10)}/${data.today.slice(5, 7)}`;
  const time = at ? `atualizado às ${TIME.format(at)}` : "";
  if (!data.current) return `como estava em ${day}`;
  if (data.future) return `${monthTitle(month).replace(/ de \d{4}$/, "")} ainda não começou · mostrando até hoje`;
  return time || `até hoje, ${day}`;
}
