// Card principal do mês atual: quanto tem nas contas até a véspera do
// pagamento, e o que isso dá por dia e por semana depois das contas
// programadas. Puro (sem React). Usa o saldo lido do banco, sem desconto de
// gasto estimado.
import type { Currency } from "../../src/domain/finance.ts";
import { diffDays } from "../../src/domain/day.ts";
import { money } from "../lib/money.ts";
import type { ProjectionView } from "../projection-view.ts";
import { ddmm } from "./format.ts";

export type CashCard = {
  eyebrow: string;
  totalCents: string;
  caption: string;
  accounts: { id: string; name: string; value: string }[];
  updated: string | null;
  perDay: string;
  perWeek: string;
  scheduled: string;
};

export function cashCard(
  pv: ProjectionView,
  currency: Currency,
  hidden: boolean,
): CashCard | null {
  const cash = pv.cash;
  if (!cash || pv.start.cents === null) return null;
  const fmt = (cents: bigint | string) => money(cents.toString(), currency, hidden);
  // Do dia de hoje até a véspera do pagamento, inclusive.
  const days = Math.max(diffDays(cash.today, pv.hero.horizonEnd) + 1, 1);
  const weeks = Math.ceil(days / 7);
  const free = BigInt(pv.start.cents) - BigInt(cash.scheduledOutCents);
  const toPay = cash.payDate ? diffDays(cash.today, cash.payDate) : null;
  return {
    eyebrow: `Até ${ddmm(pv.hero.horizonEnd)}`,
    totalCents: pv.start.cents,
    caption:
      toPay === null
        ? "Sem data de pagamento prevista"
        : toPay === 1
          ? "Falta 1 dia para o pagamento"
          : `Faltam ${toPay} dias para o pagamento`,
    accounts: cash.accounts.map((a) => ({ id: a.id, name: a.name, value: fmt(a.cents) })),
    updated: pv.start.date ? `atualizado em ${ddmm(pv.start.date)}` : null,
    perDay: fmt(free / BigInt(days)),
    perWeek: fmt(free / BigInt(weeks)),
    scheduled: fmt(cash.scheduledOutCents),
  };
}
