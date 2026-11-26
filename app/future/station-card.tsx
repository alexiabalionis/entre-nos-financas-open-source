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

const ahead = (n: number) => (n === 0 ? "este mês" : n === 1 ? "daqui a 1 mês" : `daqui a ${n} meses`);

/**
 * Descrição de um mês: marcos com o "por que nessa data", a conta linha a
 * linha e, se faltar dinheiro, um aviso. Compara a folga com o plano salvo
 * quando há rascunho. Só desenha; as contas vêm de monthCalc().
 */
export function StationCard({ index }: { index: number }) {
  const f = useFutureContext();
  const listId = useId();
  // A lista datada começa recolhida; a frase do ponto mais baixo fica à vista.
  const [listOpen, setListOpen] = useState(false);
  const result = f.draft;
  const input = f.draftInput;
  const row = result?.rows[index];
  if (!result || !input || !row) return null;
  const calc = monthCalc(input, result, index);
  const marks = milestonesByMonth(input, result, Math.min(f.months, result.rows.length)).get(index) ?? [];
  const baseRow = f.dirty ? f.base?.rows[index] : undefined;
  const paid = (input.paidFixed ?? []).filter((a) => a.month === row.month).flatMap((a) => a.items);
  const timeline = cashTimeline(row, f.hidden, paid);
  return (
    <div className={cx("ds-reset", "fut-station")}>
      <header className="fut-station-head">
        {/* A trilha já mostra o mês; o título fica para o leitor de tela. */}
        <h3 className="sr-only">{monthLong(row.month)}</h3>
        <p className="fut-station-ahead">{ahead(index)}</p>
      </header>
      {marks.length > 0 ? (
        <ul className="fut-station-marks list gap-0" aria-label="Marcos do mês">
          {marks.map((m) => (
            <li
              key={m.id}
              className={cx("list-row items-start gap-3 px-0 py-2.5", m.missed && "text-error")}
              data-missed={m.missed || undefined}
            >
              <span
                className={cx(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                  m.missed ? "bg-error/15 text-error" : "bg-primary/15 text-primary",
                )}
              >
                <Icon name="flag" size={13} />
              </span>
              <div className="list-col-grow min-w-0">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{maskMoney(m.title, f.hidden)}</p>
                {m.why.map((w) => (
                  <p key={w} className="text-xs opacity-60">
                    {maskMoney(w, f.hidden)}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <section className="fut-cash" aria-label="O mês dia a dia">
        {timeline.rows.length > 0 ? (
          <>
            <DisclosureButton
              className={cx("fut-cash-summary rounded-xl text-sm font-medium", timeline.negative && "is-negative")}
              expanded={listOpen}
              controls={listId}
              onToggle={() => setListOpen((o) => !o)}
              action={{ open: "Ver as contas por data", close: "Recolher as contas por data" }}
              iconSize={16}
            >
              {timeline.negative ? <Icon name="alert" size={16} /> : null}
              <span className="fut-cash-summary-text">{timeline.summary}</span>
            </DisclosureButton>
            <Collapse id={listId} open={listOpen}>
              <ol className="list gap-0">
                {timeline.rows.map((r) => (
                  <li key={r.key} className="list-row px-0 text-sm" data-tone={r.tone}>
                    <span className="w-12 text-xs opacity-60 tabular-nums">{r.date}</span>
                    <span
                      className={cx(
                        "list-col-grow [overflow-wrap:anywhere]",
                        r.tone === "everyday" && "italic",
                        (r.tone === "paid" || r.tone === "everyday") && "opacity-60",
                      )}
                    >
                      {r.label}
                      <small className="block text-xs opacity-60 tabular-nums">
                        {r.tone === "paid" ? "" : "saldo "}
                        {r.balance}
                      </small>
                    </span>
                    <span
                      className={cx(
                        "font-medium whitespace-nowrap tabular-nums",
                        r.tone === "in" && "text-success",
                        (r.tone === "paid" || r.tone === "everyday") && "opacity-60",
                      )}
                    >
                      {r.amount}
                    </span>
                  </li>
                ))}
              </ol>
              {timeline.everyday ? <p className="ds-caption">{timeline.everyday}</p> : null}
            </Collapse>
          </>
        ) : (
          <p className={cx("fut-cash-summary", timeline.negative && "is-negative")}>
            {timeline.negative ? <Icon name="alert" size={16} /> : null}
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
        <Callout tone="danger" icon={<Icon name="alert" size={18} />} title="O mês gasta mais do que entra">
          Faltam {formatCents(-row.free, f.hidden)} neste mês.{" "}
          {row.cash.closing >= 0n
            ? `Sai do que sobrou dos meses anteriores: a conta termina o mês com ${formatCents(row.cash.closing, f.hidden)}.`
            : `Nem o saldo em conta cobre: ele termina o mês em ${formatCents(row.cash.closing, f.hidden)}.`}
        </Callout>
      ) : null}
    </div>
  );
}
