"use client";
import { useId, useState } from "react";
import { Callout } from "../ds/callout";
import { Button } from "../ds/button";
import { BreakdownBar } from "../ds/breakdown-bar";
import { Collapse } from "../ds/collapse";
import { Panel } from "../ds/panel";
import type { Data } from "../hooks/use-month-data.ts";
import { monthName } from "../fixed/fixed-actions-model.ts";
import { money } from "../lib/money.ts";
import { BudgetDialogs } from "./budget-dialogs";
import { sortedCards, uncappedCategories } from "./budget-view-model.ts";
import {
  listSummary,
  outflowAria,
  outflowRows,
  outflowSegments,
  outflowTotals,
  REST_KEY,
  splitOutflow,
} from "./outflow-model.ts";
import { OutflowTotals } from "./outflow-totals";
import { OutflowList } from "./outflow-list";
import { useBudgetFlow } from "./use-budget-flow.ts";

/** "Saídas por categoria": composição do mês e o teto de cada categoria. */
export function OutflowBlock({
  data,
  month,
  currency,
  hidden,
  reader,
  reload,
}: {
  data: Data;
  month: string;
  currency: "BRL" | "USD" | "EUR";
  hidden: boolean;
  reader: boolean;
  reload: () => Promise<void>;
}) {
  const fmt = (cents: bigint) => money(cents.toString(), currency, hidden);
  const { budgets, categories } = data.state;
  const cards = sortedCards(budgets);
  const free = uncappedCategories(categories, budgets);
  const rows = outflowRows(data.state);
  const { main, rest } = splitOutflow(rows);
  const segments = outflowSegments(main, rest);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const listId = useId();
  const flow = useBudgetFlow({ month, currency, cards, free, categories, fmt, reload });
  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));
  // Tocar na fatia abre a lista já com a categoria aberta; "Outras" abre as pequenas.
  const pick = (key: string) => {
    setListOpen(true);
    if (key === REST_KEY) return setRestOpen(true);
    setOpenKey(key);
  };
  const openSeg = restOpen && !main.some((r) => r.key === openKey) ? REST_KEY : openKey;
  const active = listOpen ? segments.findIndex((s) => s.key === openSeg) : -1;
  const named = rows.filter((r) => r.categoryId).length;

  return (
    <>
      {flow.action.notice && (
        <Callout tone="ok" icon="✓" title="Feito">
          {flow.action.notice}
        </Callout>
      )}
      <Panel title="Saídas por categoria" meta={monthName(month)} className="mb-0">
        {rows.length === 0 ? (
          <p className="ds-caption">Nenhuma saída neste mês ainda.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <OutflowTotals totals={outflowTotals(data.state)} fmt={fmt} />
            <BreakdownBar
              showPercent
              legend={!listOpen}
              segments={segments}
              activeIndex={active < 0 ? null : active}
              onSegment={(i) => pick(segments[i].key)}
              aria={`Saídas por categoria: ${rows.map(outflowAria).join("; ")}`}
            />
            <div className="flex">
              <Button
                variant="quiet"
                size="sm"
                aria-expanded={listOpen}
                aria-controls={listId}
                onClick={() => setListOpen((o) => !o)}
              >
                {listSummary(rows)}{" "}
                <span className="ds-collapse-arrow ml-1" aria-hidden="true">
                  ↓
                </span>
              </Button>
            </div>
            <Collapse id={listId} open={listOpen}>
              <p className="ds-caption">
                {cards.length} de {named} categorias com teto. Toque numa
                categoria para ver o teto.
              </p>
              <OutflowList
                main={main}
                rest={rest}
                openKey={openKey}
                restOpen={restOpen}
                onToggleRow={toggle}
                onToggleRest={() => setRestOpen((o) => !o)}
                actions={{
                  fmt,
                  month,
                  hidden,
                  reader,
                  onDetail: flow.openDetail,
                  onForm: flow.openForm,
                }}
              />
            </Collapse>
          </div>
        )}
      </Panel>
      <BudgetDialogs
        flow={flow}
        data={data}
        cards={cards}
        free={free}
        month={month}
        currency={currency}
        hidden={hidden}
        reader={reader}
        fmt={fmt}
      />
    </>
  );
}
