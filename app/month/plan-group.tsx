"use client";

import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import { money } from "../lib/money.ts";
import { CategoryIcon } from "../family-categories";
import { brDate } from "../../src/domain/format.ts";
import { eventName } from "../../src/domain/event-name.ts";
import type { Currency } from "../../src/domain/finance.ts";
import { FixedItemMeta } from "../fixed/fixed-item-meta";
import { Panel } from "../ds/panel";
import { StatusChip } from "../ds/status-chip";
import {
  fixedSubtitle,
  isLegacyFixed,
  isSeriesBill,
  shownCents,
} from "../fixed/fixed-status.ts";
import {
  itemStatusText,
  itemsInGroup,
  paidWithoutEntryCents,
  plannedTotal,
  type PLAN_GROUPS,
} from "./plan-model.ts";

export function PlanGroup({
  group,
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
  onAdd,
}: {
  group: (typeof PLAN_GROUPS)[number];
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
  onAdd: () => void;
}) {
  const groupItems = itemsInGroup(items, group.id);
  const meta =
    money(plannedTotal(groupItems).toString(), currency, hidden) +
    " previsto" +
    (groupItems.some((i) => i.planned_cents === null) ? " · parcial" : "");
  return (
    <div role="region" aria-label={group.title}>
      <Panel title={group.title} meta={meta}>
        <p className="ds-caption">{group.description}</p>
        <div className="ds-list list gap-0">
          {groupItems.map((i) => (
            <article
              key={i.id}
              className={
                "list-row items-center px-0 " + (i.status === "done" ? "opacity-60" : "")
              }
            >
              <button
                className="btn btn-circle btn-ghost btn-sm"
                disabled={busy || reader}
                aria-label={
                  (i.status === "done" ? "Reabrir " : "Concluir ") + i.label
                }
                onClick={() => onCheck(i)}
              >
                {i.status === "done"
                  ? "✓"
                  : i.status === "partial"
                    ? "½"
                    : i.purpose === "income"
                      ? "↓"
                      : "○"}
              </button>
              <button
                className="list-col-grow cursor-pointer text-left"
                onClick={() => onOpenItem(i)}
              >
                <strong className="flex items-center gap-2 text-sm font-medium">
                  <span className="inline-flex size-5 items-center justify-center">
                    <CategoryIcon
                      name={
                        categories.find((c) => c.id === i.category_id)?.name ??
                        i.label
                      }
                    />
                  </span>
                  {i.label}
                </strong>
                <span className="block text-xs opacity-60">
                  {isSeriesBill(i)
                    ? fixedSubtitle(i, today, hidden)
                    : itemStatusText(i, today)}
                  {i.funding && (
                    <span className="block">
                      {i.funding.received_date
                        ? "Crédito no banco em " + brDate(i.funding.received_date)
                        : (i.funding.receipt_mode === "business_window"
                            ? "Janela aproximada até "
                            : "Recebimento previsto em ") +
                          brDate(i.funding.expected_date)}{" "}
                      · financia este mês. {i.funding.note}
                    </span>
                  )}
                </span>
              </button>
              <strong className="text-sm font-medium whitespace-nowrap tabular-nums">
                {money(
                  isSeriesBill(i) ? shownCents(i) : i.planned_cents,
                  currency,
                  hidden,
                )}
              </strong>
              {isSeriesBill(i) && (
                <div className="list-col-wrap">
                  <FixedItemMeta item={i} hidden={hidden} />
                </div>
              )}
              {paidWithoutEntryCents(i) > 0n && (
                <div className="list-col-wrap flex flex-wrap items-center gap-2">
                  <StatusChip label="Pago sem lançamento associado" />
                  <span className="text-xs opacity-60">
                    {money(paidWithoutEntryCents(i).toString(), currency, hidden)}
                  </span>
                </div>
              )}
              {isLegacyFixed(i) && (
                <div className="list-col-wrap flex flex-wrap items-center gap-2">
                  <StatusChip label="Fixa antiga" />
                </div>
              )}
              {i.derived && i.category_id && !hidden && (
                <details className="list-col-wrap collapse collapse-arrow border border-base-300">
                  <summary className="collapse-title flex items-center gap-2 text-sm">Ver o que está incluído</summary>
                  <ul className="collapse-content flex flex-col gap-1 text-xs">
                    {events
                      .filter(
                        (e) =>
                          e.category_id === i.category_id &&
                          e.currency === currency &&
                          ["expense", "fee", "card_purchase"].includes(e.kind),
                      )
                      .map((e) => (
                        <li key={e.id} className="flex justify-between gap-2">
                          <span className="opacity-60">{eventName(e)}</span>
                          <strong className="font-medium tabular-nums">
                            {money(
                              (-BigInt(e.amount_cents)).toString(),
                              currency,
                              hidden,
                            )}
                          </strong>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
          {!groupItems.length && (
            <p className="ds-caption">
              {groupItems.length
                ? "Nenhum item neste filtro."
                : "Ainda não há itens planejados."}
            </p>
          )}
        </div>
        <button
          className="btn btn-ghost btn-sm self-start"
          aria-label={group.action}
          disabled={busy || reader}
          onClick={onAdd}
        >
          ＋ {group.action}
        </button>
      </Panel>
    </div>
  );
}
