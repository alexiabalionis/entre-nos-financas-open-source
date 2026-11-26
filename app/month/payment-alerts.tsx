"use client";

import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import { money } from "../lib/money.ts";
import { Panel } from "../ds/panel";
import { brDate } from "../../src/domain/format.ts";
import type { Currency } from "../../src/domain/finance.ts";
import type { paymentReminders } from "../../src/domain/reminders.ts";

export function PaymentAlerts({
  cards,
  reminders,
  items,
  currency,
  hidden,
  onConfigureAlarms,
  onReviewCard,
  onOpenItem,
}: {
  cards: Data["cards"];
  reminders: ReturnType<typeof paymentReminders>;
  items: MonthItem[];
  currency: Currency;
  hidden: boolean;
  onConfigureAlarms: () => void;
  onReviewCard: (localAccountId: string) => void;
  onOpenItem: (item: MonthItem) => void;
}) {
  const rowCls =
    "list-row w-full cursor-pointer items-center px-0 text-left text-inherit no-underline";
  const titleCls = "block text-sm font-medium";
  const subCls = "block text-xs opacity-60";
  const trailCls = "text-sm font-medium whitespace-nowrap tabular-nums text-right";
  return (
    <div role="region" aria-label="Alarmes e vencimentos">
      <Panel title="Alarmes e vencimentos">
        <button
          type="button"
          className="btn btn-soft btn-sm self-start"
          onClick={onConfigureAlarms}
        >
          Configurar alarmes
        </button>
        <p className="ds-caption">
          Avisos no app e, com sua permissão, no iPhone. Nenhum pagamento é feito
          automaticamente.
        </p>
        <div className="ds-list list gap-0">
          {cards
            .filter(
              (c) =>
                c.manual_bill &&
                !c.manual_bill.paid &&
                BigInt(c.manual_bill.amount_cents) > 0n,
            )
            .map((c) => (
              <a
                className={rowCls}
                key={"manual-" + c.id}
                href={"#card-" + c.local_account_id}
              >
                <span className="list-col-grow">
                  <strong className={titleCls}>{c.name}</strong>
                  <small className={subCls}>
                    Fatura informada · vence {brDate(c.manual_bill!.due_date)}
                  </small>
                </span>
                <span className={trailCls}>
                  {money(c.manual_bill!.amount_cents, currency, hidden)}
                  <small className={subCls}>em aberto</small>
                </span>
              </a>
            ))}
          {cards
            .filter((c) => c.projection && !c.projection.needs_review)
            .map((c) => (
              <button
                type="button"
                className={rowCls}
                key={"card-cycle-" + c.id}
                onClick={() => onReviewCard(c.local_account_id)}
              >
                <span className="list-col-grow">
                  <strong className={titleCls}>{c.name}</strong>
                  <small className={subCls}>
                    Conferir fatura · vencimento informado:{" "}
                    {brDate(c.projection!.due_date)}
                  </small>
                </span>
                <span className={trailCls}>
                  {money(c.projection!.total_cents, currency, hidden)}
                  <small className={subCls}>estimativa</small>
                </span>
              </button>
            ))}
          {reminders.dated.slice(0, 3).map((r) => (
            <button
              type="button"
              className={rowCls}
              key={r.id}
              onClick={() => onOpenItem(items.find((i) => i.id === r.id)!)}
            >
              <span className="list-col-grow">
                <strong className={titleCls}>{r.label}</strong>
                <small
                  className={
                    subCls +
                    (r.urgency === "overdue"
                      ? " text-error opacity-100"
                      : r.urgency === "today"
                        ? " text-warning opacity-100"
                        : "")
                  }
                >
                  {r.urgency === "overdue"
                    ? "Em atraso"
                    : r.urgency === "today"
                      ? "Vence hoje"
                      : "Vence em " + brDate(r.due_date!)}
                </small>
              </span>
              <span className={trailCls}>
                {money(r.remaining_cents, currency, hidden)}
              </span>
            </button>
          ))}
        </div>
        {!reminders.dated.length && (
          <p className="ds-caption">
            Nenhuma conta em aberto com vencimento definido neste mês.
          </p>
        )}
        {!!reminders.missingDates.length && (
          <details className="collapse collapse-arrow border border-base-300">
            <summary className="collapse-title flex items-center gap-2 text-sm">
              {reminders.missingDates.length} conta(s) sem vencimento — definir
              para receber alarmes
            </summary>
            <div className="collapse-content ds-list list gap-0">
              {reminders.missingDates.map((r) => (
                <button
                  type="button"
                  className={rowCls}
                  key={r.id}
                  onClick={() => onOpenItem(items.find((i) => i.id === r.id)!)}
                >
                  <span className={"list-col-grow " + titleCls}>{r.label}</span>
                  <span className="text-xs opacity-60">Definir data</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </Panel>
    </div>
  );
}
