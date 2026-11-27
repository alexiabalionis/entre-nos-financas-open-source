"use client";

import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import { money } from "../lib/money.ts";
import { CategoryIcon } from "../family-categories";
import { brDate } from "../../src/domain/format.ts";
import { eventName } from "../../src/domain/event-name.ts";
import type { Currency } from "../../src/domain/finance.ts";
import { FixedItemMeta } from "../fixed/fixed-item-meta";
import { Button } from "../ds/button";
import { Icon } from "../ds/icon";
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
  flat = true,
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
  flat?: boolean;
  onCheck: (item: MonthItem) => void;
  onOpenItem: (item: MonthItem) => void;
  onAdd: () => void;
}) {
  const groupItems = itemsInGroup(items, group.id);
  const meta =
    money(plannedTotal(groupItems).toString(), currency, hidden) +
    " previsto" +
    (groupItems.some((i) => i.planned_cents === null) ? " · parcial" : "");

  const content = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          {flat ? (
            <h3 className="m-0 text-sm font-semibold text-ink">{group.title}</h3>
          ) : null}
          <p className="ds-caption m-0 text-xs">{group.description}</p>
        </div>
        {flat ? (
          <span className="font-numeric text-xs font-semibold tabular-nums text-muted">
            {meta}
          </span>
        ) : null}
      </div>

      {groupItems.length > 0 ? (
        <div className="flex flex-col divide-y divide-border">
          {groupItems.map((i) => {
            const done = i.status === "done";
            const partial = i.status === "partial";
            return (
              <article
                key={i.id}
                className={`py-2.5 ${done ? "opacity-65" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={`ui-reset-btn inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      done
                        ? "border-ok bg-ok text-white"
                        : partial
                          ? "border-accent bg-accent-soft text-accent-ink font-semibold"
                          : "border-border-strong bg-surface text-muted hover:border-accent hover:text-accent-ink"
                    }`}
                    disabled={busy || reader}
                    aria-label={(done ? "Reabrir " : "Concluir ") + i.label}
                    onClick={() => onCheck(i)}
                  >
                    {done ? (
                      <Icon name="check" size={14} />
                    ) : partial ? (
                      <span className="text-xs leading-none">½</span>
                    ) : i.purpose === "income" ? (
                      <Icon name="in" size={13} />
                    ) : null}
                  </button>

                  <button
                    type="button"
                    className="ui-row-btn flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer rounded-lg py-0.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => onOpenItem(i)}
                  >
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink">
                      <CategoryIcon
                        name={
                          categories.find((c) => c.id === i.category_id)?.name ??
                          i.label
                        }
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong
                        className={`block truncate text-sm font-medium text-ink ${
                          done ? "line-through decoration-muted/60" : ""
                        }`}
                      >
                        {i.label}
                      </strong>
                      <span className="block text-xs text-muted leading-snug">
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
                    </span>
                  </button>

                  <strong className="shrink-0 font-numeric text-sm font-semibold whitespace-nowrap tabular-nums text-ink">
                    {money(
                      isSeriesBill(i) ? shownCents(i) : i.planned_cents,
                      currency,
                      hidden,
                    )}
                  </strong>
                </div>

                {(isSeriesBill(i) ||
                  paidWithoutEntryCents(i) > 0n ||
                  isLegacyFixed(i) ||
                  (i.derived && i.category_id && !hidden)) && (
                  <div className="mt-2 flex flex-col gap-1.5 pl-10">
                    {isSeriesBill(i) && <FixedItemMeta item={i} hidden={hidden} />}
                    {paidWithoutEntryCents(i) > 0n && (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label="Pago sem lançamento associado" />
                        <span className="font-numeric text-xs tabular-nums text-muted">
                          {money(paidWithoutEntryCents(i).toString(), currency, hidden)}
                        </span>
                      </div>
                    )}
                    {isLegacyFixed(i) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label="Fixa antiga" />
                      </div>
                    )}
                    {i.derived && i.category_id && !hidden && (
                      <details className="rounded-xl border border-border bg-surface-2/50 px-3 py-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
                          <span>Ver o que está incluído</span>
                          <Icon name="down" size={14} />
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs">
                          {events
                            .filter(
                              (e) =>
                                e.category_id === i.category_id &&
                                e.currency === currency &&
                                ["expense", "fee", "card_purchase"].includes(e.kind),
                            )
                            .map((e) => (
                              <li key={e.id} className="flex justify-between gap-2">
                                <span className="truncate text-muted">{eventName(e)}</span>
                                <strong className="font-numeric font-medium tabular-nums text-ink">
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
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="ds-caption py-2">Ainda não há itens planejados.</p>
      )}

      <div className="pt-1">
        <Button
          variant="quiet"
          size="sm"
          icon="plus"
          aria-label={group.action}
          disabled={busy || reader}
          onClick={onAdd}
        >
          {group.action}
        </Button>
      </div>
    </div>
  );

  if (flat) {
    return (
      <div
        role="region"
        aria-label={group.title}
        className="border-t border-border pt-4 first:border-t-0 first:pt-0"
      >
        {content}
      </div>
    );
  }

  return (
    <div role="region" aria-label={group.title}>
      <Panel title={group.title} meta={meta} className="mb-0">
        {content}
      </Panel>
    </div>
  );
}
