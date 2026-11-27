"use client";
import { useId, useState } from "react";
import { monthLong } from "../../src/domain/future-months.ts";
import { formatCents, maskMoney, toReais } from "../lib/cents.ts";
import { CalcList, DisclosureButton, Icon } from "../ds/index.ts";
import { Callout } from "../ds/callout.tsx";
import { Collapse } from "../ds/collapse.tsx";
import { cx } from "../ds/shared.ts";
import { useFutureContext } from "./future-context.tsx";
import { cashTimeline, milestonesByMonth, monthCalc } from "./view-model.ts";

const ahead = (n: number) =>
  n === 0 ? "este mês" : n === 1 ? "daqui a 1 mês" : `daqui a ${n} meses`;

export function StationCard({ index }: { index: number }) {
  const f = useFutureContext();
  const listId = useId();
  const [listOpen, setListOpen] = useState(false);
  const result = f.draft;
  const input = f.draftInput;
  const row = result?.rows[index];
  if (!result || !input || !row) return null;
  const calc = monthCalc(input, result, index);
  const marks =
    milestonesByMonth(input, result, Math.min(f.months, result.rows.length)).get(
      index,
    ) ?? [];
  const baseRow = f.dirty ? f.base?.rows[index] : undefined;
  const paid = (input.paidFixed ?? [])
    .filter((a) => a.month === row.month)
    .flatMap((a) => a.items);
  const timeline = cashTimeline(row, f.hidden, paid);

  return (
    <div className={cx("ds-reset flex min-w-0 flex-col gap-3.5")}>
      <header className="grid gap-0.5">
        <h3 className="sr-only">{monthLong(row.month)}</h3>
        <p className="m-0 text-xs font-medium text-muted">{ahead(index)}</p>
      </header>

      {marks.length > 0 ? (
        <ul
          className="m-0 flex list-none flex-col divide-y divide-border p-0"
          aria-label="Marcos do mês"
        >
          {marks.map((m) => (
            <li
              key={m.id}
              className={cx(
                "flex items-start gap-3 rounded-xl py-2.5",
                m.missed && "bg-danger-bg/60 px-3 text-danger",
              )}
              data-missed={m.missed || undefined}
            >
              <span
                className={cx(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                  m.missed
                    ? "bg-danger-bg text-danger"
                    : "bg-accent-soft text-accent-ink",
                )}
              >
                <Icon name="flag" size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">
                  {maskMoney(m.title, f.hidden)}
                </p>
                {m.why.map((w) => (
                  <p key={w} className="m-0 mt-0.5 text-xs text-muted">
                    {maskMoney(w, f.hidden)}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="grid min-w-0 gap-2.5" aria-label="O mês dia a dia">
        {timeline.rows.length > 0 ? (
          <>
            <DisclosureButton
              className={cx(
                "rounded-xl text-sm font-medium",
                timeline.negative && "text-danger",
              )}
              expanded={listOpen}
              controls={listId}
              onToggle={() => setListOpen((o) => !o)}
              action={{
                open: "Ver as contas por data",
                close: "Recolher as contas por data",
              }}
              iconSize={16}
            >
              <span className="flex min-w-0 items-center gap-2">
                {timeline.negative ? <Icon name="alert" size={16} /> : null}
                <span className="min-w-0">{timeline.summary}</span>
              </span>
            </DisclosureButton>
            <Collapse id={listId} open={listOpen}>
              <ol className="m-0 flex list-none flex-col divide-y divide-border p-0">
                {timeline.rows.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-start gap-3 py-2 text-sm"
                    data-tone={r.tone}
                  >
                    <span className="w-12 shrink-0 font-numeric text-xs tabular-nums text-muted">
                      {r.date}
                    </span>
                    <span
                      className={cx(
                        "min-w-0 flex-1 text-ink [overflow-wrap:anywhere]",
                        r.tone === "everyday" && "italic",
                        (r.tone === "paid" || r.tone === "everyday") &&
                          "text-muted",
                      )}
                    >
                      {r.label}
                      <small className="block font-numeric text-xs tabular-nums text-muted">
                        {r.tone === "paid" ? "" : "saldo "}
                        {r.balance}
                      </small>
                    </span>
                    <span
                      className={cx(
                        "shrink-0 font-numeric font-medium whitespace-nowrap tabular-nums",
                        r.tone === "in"
                          ? "text-ok"
                          : r.tone === "paid" || r.tone === "everyday"
                            ? "text-muted"
                            : "text-ink",
                      )}
                    >
                      {r.amount}
                    </span>
                  </li>
                ))}
              </ol>
              {timeline.everyday ? (
                <p className="ds-caption mt-2">{timeline.everyday}</p>
              ) : null}
            </Collapse>
          </>
        ) : (
          <p
            className={cx(
              "m-0 flex items-start gap-2 text-sm font-medium",
              timeline.negative ? "text-danger" : "text-ink",
            )}
          >
            {timeline.negative ? (
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            ) : null}
            <span>{timeline.summary}</span>
          </p>
        )}
      </section>

      <CalcList
        lines={calc.lines}
        total={calc.total}
        hidden={f.hidden}
        compareTotal={baseRow ? toReais(baseRow.free) : undefined}
      />

      {row.free < 0n ? (
        <Callout
          tone="danger"
          icon={<Icon name="alert" size={18} />}
          title="O mês gasta mais do que entra"
        >
          Faltam {formatCents(-row.free, f.hidden)} neste mês.{" "}
          {row.cash.closing >= 0n
            ? `Sai do que sobrou dos meses anteriores: a conta termina o mês com ${formatCents(row.cash.closing, f.hidden)}.`
            : `Nem o saldo em conta cobre: ele termina o mês em ${formatCents(row.cash.closing, f.hidden)}.`}
        </Callout>
      ) : null}
    </div>
  );
}
