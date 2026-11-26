"use client";
// Topo do mês atual: saldo das contas até a véspera do pagamento. Tocar no
// valor mostra o saldo de cada conta; abrir o card mostra por dia, por semana
// e as contas programadas, com a data da leitura do saldo. Não calcula: tudo
// vem de cashCard() (app/month/cash.ts).
import type { Currency } from "../../../src/domain/finance.ts";
import { formatted } from "../../../src/domain/format.ts";
import { StatBanner } from "../../ds/stat-banner.tsx";
import { RowList } from "../../ds/row-list.tsx";
import { Veil } from "../../ds/veil.tsx";
import type { CashCard } from "../cash.ts";
import { countUpMoney } from "./money.tsx";

export function CashBanner({
  card,
  currency,
  hidden,
}: {
  card: CashCard;
  currency: Currency;
  hidden: boolean;
}) {
  const value = hidden ? (
    <Veil text={formatted(card.totalCents, currency)} hidden />
  ) : (
    countUpMoney(card.totalCents, currency)
  );
  const columns = [
    { label: "por dia", value: card.perDay },
    { label: "por semana", value: card.perWeek },
    { label: "contas programadas", value: card.scheduled },
  ];
  return (
    <StatBanner
      inverted
      eyebrow={card.eyebrow}
      value={value}
      neg={!hidden && BigInt(card.totalCents) < 0n}
      caption={card.caption}
      valueDetail={
        card.accounts.length > 0
          ? {
              label: "Ver saldo de cada conta",
              content: (
                <div className="text-sm [&_.list-row]:px-0 [&_.list-row]:py-1.5">
                  <RowList
                    rows={card.accounts.map((a) => ({ title: a.name, trail: a.value }))}
                    bordered={false}
                  />
                </div>
              ),
            }
          : undefined
      }
      expand={{
        label: "Ver por dia e por semana",
        content: (
          <>
            {card.updated ? (
              <p className="ds-caption mb-2 text-right text-xs opacity-60">{card.updated}</p>
            ) : null}
            <dl className="grid grid-cols-3 gap-3">
              {columns.map((c) => (
                <div key={c.label} className="min-w-0">
                  <dt className="ds-caption text-xs opacity-60">{c.label}</dt>
                  <dd className="m-0 font-semibold tabular-nums [font-family:var(--family-font-numeric)]">
                    {c.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ),
      }}
    />
  );
}
