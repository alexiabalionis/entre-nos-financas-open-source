"use client";
import type { Data, MonthItem } from "../hooks/use-month-data.ts";
import type { MonthModel } from "./model.ts";
import { money } from "../lib/money.ts";
import { brDate } from "../../src/domain/format.ts";
import type { Currency } from "../../src/domain/finance.ts";
import type { paymentReminders } from "../../src/domain/reminders.ts";
import { Button } from "../ds/button.tsx";
import { Icon } from "../ds/icon.tsx";
import { RowList } from "../ds/row-list.tsx";
import { StatusChip } from "../ds/status-chip.tsx";

/**
 * Zona 2 — Atenção agora: unifica alarmes/vencimentos, faturas a conferir
 * e pendências do modelo em uma faixa limpa e calma.
 */
export function AttentionStrip({
  cards,
  reminders,
  items,
  model,
  currency,
  hidden,
  onConfigureAlarms,
  onReviewCard,
  onOpenItem,
}: {
  cards: Data["cards"];
  reminders: ReturnType<typeof paymentReminders>;
  items: MonthItem[];
  model: MonthModel;
  currency: Currency;
  hidden: boolean;
  onConfigureAlarms: () => void;
  onReviewCard: (localAccountId: string) => void;
  onOpenItem: (item: MonthItem) => void;
}) {
  const manualBills = cards.filter(
    (c) =>
      c.manual_bill &&
      !c.manual_bill.paid &&
      BigInt(c.manual_bill.amount_cents) > 0n,
  );
  const reviewCards = cards.filter((c) => c.projection && !c.projection.needs_review);
  const datedReminders = reminders.dated;
  const gaps = model.show.gaps ? model.pendingRows : [];

  const totalActionable =
    manualBills.length +
    reviewCards.length +
    datedReminders.length +
    gaps.length;

  const missingDates = reminders.missingDates;

  // Tudo em dia: barra compacta de 1 linha sem poluir a tela.
  if (totalActionable === 0 && missingDates.length === 0) {
    return (
      <section
        aria-label="Atenção agora"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
      >
        <div className="flex items-center gap-2.5 text-sm">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-ok-bg text-ok">
            <Icon name="check" size={14} />
          </span>
          <span className="font-medium text-ink">Tudo em dia neste mês</span>
          <span className="hidden sm:inline text-xs text-muted">
            · Nenhum vencimento ou pendência aberta.
          </span>
        </div>
        <Button variant="text" size="sm" onClick={onConfigureAlarms}>
          Configurar alarmes
        </Button>
      </section>
    );
  }

  const rowCls =
    "ui-row-btn flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface-2/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <section
      aria-label="Atenção agora"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="m-0 text-[0.9375rem] font-semibold tracking-tight text-ink">
            Atenção agora
          </h2>
          {totalActionable > 0 ? (
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 font-numeric text-xs font-semibold tabular-nums text-accent-ink">
              {totalActionable}
            </span>
          ) : null}
        </div>
        <Button variant="text" size="sm" onClick={onConfigureAlarms}>
          Configurar alarmes
        </Button>
      </div>

      {/* Vencimentos urgentes, faturas de cartão e lembretes datados */}
      {(manualBills.length > 0 || reviewCards.length > 0 || datedReminders.length > 0) && (
        <div className="flex flex-col divide-y divide-border -mx-2.5">
          {manualBills.map((c) => (
            <a
              key={"manual-" + c.id}
              href={"#card-" + c.local_account_id}
              className={`${rowCls} no-underline text-inherit`}
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-medium text-ink">
                  {c.name}
                </strong>
                <small className="block text-xs text-muted">
                  Fatura informada · vence {brDate(c.manual_bill!.due_date)}
                </small>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <StatusChip tone="warn" label="Em aberto" />
                <span className="font-numeric text-sm font-semibold tabular-nums text-ink">
                  {money(c.manual_bill!.amount_cents, currency, hidden)}
                </span>
              </span>
            </a>
          ))}

          {reviewCards.map((c) => (
            <button
              key={"card-cycle-" + c.id}
              type="button"
              className={rowCls}
              onClick={() => onReviewCard(c.local_account_id)}
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-medium text-ink">
                  {c.name}
                </strong>
                <small className="block text-xs text-muted">
                  Conferir fatura · vencimento {brDate(c.projection!.due_date)}
                </small>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <StatusChip tone="accent" label="Estimativa" />
                <span className="font-numeric text-sm font-semibold tabular-nums text-ink">
                  {money(c.projection!.total_cents, currency, hidden)}
                </span>
              </span>
            </button>
          ))}

          {datedReminders.map((r) => {
            const tone =
              r.urgency === "overdue"
                ? "danger"
                : r.urgency === "today"
                  ? "warn"
                  : "neutral";
            const badge =
              r.urgency === "overdue"
                ? "Em atraso"
                : r.urgency === "today"
                  ? "Vence hoje"
                  : `Vence ${brDate(r.due_date!)}`;
            const target = items.find((i) => i.id === r.id);
            return (
              <button
                key={r.id}
                type="button"
                className={rowCls}
                onClick={() => target && onOpenItem(target)}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-medium text-ink">
                    {r.label}
                  </strong>
                  <small className="block text-xs text-muted">
                    {r.urgency === "overdue"
                      ? "Compromisso vencido no plano"
                      : r.urgency === "today"
                        ? "Programado para hoje"
                        : "Vencimento próximo"}
                  </small>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <StatusChip tone={tone} label={badge} />
                  <span className="font-numeric text-sm font-semibold tabular-nums text-ink">
                    {money(r.remaining_cents, currency, hidden)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Pendências / lacunas de valor */}
      {gaps.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Precisa de você
          </p>
          <RowList rows={gaps} />
        </div>
      )}

      {/* Contas sem vencimento colapsadas em uma linha */}
      {missingDates.length > 0 && (
        <details className="rounded-xl border border-border bg-surface-2/50 px-3.5 py-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
            <span>
              {missingDates.length}{" "}
              {missingDates.length === 1
                ? "conta sem vencimento — definir data para receber alarmes"
                : "contas sem vencimento — definir data para receber alarmes"}
            </span>
            <Icon name="down" size={14} />
          </summary>
          <div className="mt-2 flex flex-col divide-y divide-border border-t border-border pt-1">
            {missingDates.map((r) => {
              const target = items.find((i) => i.id === r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={rowCls}
                  onClick={() => target && onOpenItem(target)}
                >
                  <span className="truncate text-sm font-medium text-ink">
                    {r.label}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-accent-ink">
                    Definir data
                  </span>
                </button>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
