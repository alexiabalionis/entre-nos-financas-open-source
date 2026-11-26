import type { Transaction } from "@electric-sql/pglite";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { economicEffect, type Kind } from "../domain/finance.ts";
import { addDays } from "../domain/day.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import {
  balanceSeries,
  categoryByMonth,
  categoryPeriods,
  dailySpend,
  fixedSplit,
  monthSummary,
  places,
  insightsAnchor,
  NO_CATEGORY,
  type MonthFlow,
} from "../domain/insights.ts";
import {
  readAutoCountedChecking,
  readRealizedSpend,
  type RealizedSpend,
} from "./realized-spend.ts";
import { readToday } from "./projection.ts";
import { fixedEventIds } from "./fixed-events.ts";
import { readable } from "./projection-reads-recurrences.ts";
import type { Wire } from "./copilot.ts";

// Panorama: o que a casa ganha, guarda e gasta, e para onde vai. Só leitura,
// por família (RLS + household_id). Tudo em BRL. Entradas e saídas vêm dos
// lançamentos aprovados; os gastos detalhados somam também o que o banco já
// trouxe e ainda espera aprovação (mesma fonte do Copiloto). A saída mensal é a
// soma desse mesmo consumo líquido, então fecha com categorias e dias; a
// entrada soma eventos e as entradas pendentes que o Mês também conta.

export type IncomeEntry = {
  id: string;
  date: string;
  cents: bigint;
  kind: Kind;
  description: string;
  source: "event" | "bank";
};

// Cada linha que o Panorama soma como entrada. Fonte única: readMonthFlows soma
// daqui e renda_por_tipo classifica daqui, então os dois fecham.
export async function readIncomeEntries(
  tx: Transaction,
  p: { familyId: string; from: string; to: string },
): Promise<IncomeEntry[]> {
  const [events, checking] = await Promise.all([
    tx.query<{ id: string; kind: Kind; amount_cents: string; date: string; description: string }>(
      `SELECT id::text,kind,amount_cents::text,transaction_date::text AS date,description
       FROM economic_events
       WHERE household_id=$1 AND currency='BRL'
         AND transaction_date>=$2::date AND transaction_date<$3::date`,
      [p.familyId, p.from, p.to],
    ),
    readAutoCountedChecking(tx, p),
  ]);
  const out: IncomeEntry[] = [];
  for (const r of events.rows) {
    const cents = economicEffect(r.kind, BigInt(r.amount_cents)).income;
    if (cents !== 0n) out.push({ id: r.id, date: r.date, cents, kind: r.kind, description: r.description, source: "event" });
  }
  for (const r of checking) {
    const cents = BigInt(r.amount_cents);
    if (cents > 0n)
      out.push({ id: r.id, date: r.transaction_date, cents, kind: "income", description: r.description, source: "bank" });
  }
  return out;
}

export async function readMonthFlows(
  tx: Transaction,
  p: { familyId: string; from: string; to: string },
  spend: readonly RealizedSpend[],
): Promise<MonthFlow[]> {
  const entries = await readIncomeEntries(tx, p);
  const byMonth = new Map<string, MonthFlow>();
  // `to` é exclusivo (amanhã): o último mês é o do dia anterior a ele.
  const lastMonth = addDays(p.to, -1).slice(0, 7);
  for (let m = p.from.slice(0, 7); m <= lastMonth; m = shiftMonth(m, 1))
    byMonth.set(m, { month: m, in: 0n, out: 0n });
  for (const e of entries) {
    const flow = byMonth.get(e.date.slice(0, 7));
    if (flow) flow.in += e.cents;
  }
  for (const r of spend) {
    const flow = byMonth.get(r.date.slice(0, 7));
    if (flow) flow.out += r.cents;
  }
  return [...byMonth.values()];
}

// Saldo das contas correntes no fim de cada dia, pelos lançamentos
// registrados, desde o saldo inicial de cada conta (antes dele não há linha).
async function readBalance(
  tx: Transaction,
  p: { familyId: string; from: string; to: string },
) {
  const accounts = (
    await tx.query<{ id: string; opening_cents: string; opening_date: string }>(
      `SELECT id,opening_cents::text,opening_date::text FROM accounts
       WHERE household_id=$1 AND kind='checking' AND currency='BRL'
         AND opening_cents IS NOT NULL`,
      [p.familyId],
    )
  ).rows;
  if (!accounts.length) return [];
  const moves = (
    await tx.query<{ account_id: string; day: string; cents: string }>(
      `SELECT l.account_id,l.transaction_date::text AS day,sum(l.amount_cents)::text AS cents
       FROM ledger_entries l JOIN accounts a ON a.household_id=l.household_id AND a.id=l.account_id
       WHERE l.household_id=$1 AND a.kind='checking' AND a.currency='BRL'
         AND l.transaction_date>a.opening_date AND l.transaction_date<=$2::date
       GROUP BY l.account_id,l.transaction_date`,
      [p.familyId, p.to],
    )
  ).rows;
  const earliest = accounts.map((a) => a.opening_date).sort()[0];
  return balanceSeries({
    from: earliest > p.from ? earliest : p.from,
    to: p.to,
    accounts: accounts.map((a) => ({
      id: a.id,
      openingCents: BigInt(a.opening_cents),
      openingDate: a.opening_date,
    })),
    moves: moves.map((m) => ({
      account: m.account_id,
      date: m.day,
      cents: BigInt(m.cents),
    })),
  });
}

export async function readInsights(
  db: Database,
  user: Identity,
  opts: { today?: string; month?: string } = {},
) {
  return asUser(db, user.userId, async (tx) => {
    const anchor = insightsAnchor(opts.today ?? (await readToday(tx)), opts.month);
    const today = anchor.today;
    const month = today.slice(0, 7);
    const yearFrom = shiftMonth(month, -11) + "-01";
    const tomorrow = addDays(today, 1);
    const scope = { familyId: user.familyId, from: yearFrom, to: tomorrow };
    const [spend, balance] = await Promise.all([
      readRealizedSpend(tx, scope),
      readBalance(tx, {
        familyId: user.familyId,
        from: addDays(today, -365),
        to: today,
      }),
    ]);
    const months = await readMonthFlows(tx, scope, spend);
    const fixedEvents = await fixedEventIds(
      tx,
      user.familyId,
      spend.flatMap((s) => (s.eventId ? [s.eventId] : [])),
    );
    const toPlaces = (from: string) =>
      places(spend, from).map((pl) => ({
        ...pl,
        label: readable(pl.merchant),
      }));
    return {
      today,
      current: anchor.current,
      future: anchor.future,
      months,
      summary: monthSummary(months, month),
      balance,
      categories: categoryPeriods(spend, today),
      categoryMonths: categoryByMonth(
        spend,
        months.map((m) => m.month),
      ),
      fixed: fixedSplit(spend, { month, fixedEvents }),
      days: dailySpend(spend, today),
      places: {
        quarter: toPlaces(shiftMonth(month, -2) + "-01"),
        year: toPlaces(yearFrom),
      },
    };
  });
}

export type Insights = Awaited<ReturnType<typeof readInsights>>;
export type InsightsWire = Wire<Insights>;

// Gasto de um mês inteiro por categoria, todas elas, do maior para o menor.
// Mesma fonte e mesma regra do Panorama (categoryByMonth), então a soma fecha
// com a saída mensal de readInsights. Estorno entra com sinal negativo.
export async function readCategorySpend(
  db: Database,
  user: Identity,
  month: string,
) {
  return asUser(db, user.userId, async (tx) => {
    const spend = await readRealizedSpend(tx, {
      familyId: user.familyId,
      from: `${month}-01`,
      to: `${shiftMonth(month, 1)}-01`,
    });
    const categories = categoryByMonth(spend, [month])
      .map(({ name, cents }) => ({
        name,
        cents,
        // Cada compra da categoria, aprovada ou ainda pendente no banco.
        items: spend
          .filter(
            (s) =>
              s.date.startsWith(month) &&
              (s.categoryName ?? NO_CATEGORY) === name,
          )
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((s) => ({
            date: s.date,
            label: s.label,
            cents: s.cents,
            confirmed: s.source === "event",
          })),
      }))
      .sort((a, b) => (a.cents < b.cents ? 1 : a.cents > b.cents ? -1 : 0));
    return {
      month,
      categories,
      total_cents: categories.reduce((s, c) => s + c.cents, 0n),
    };
  });
}
export type CategorySpend = Awaited<ReturnType<typeof readCategorySpend>>;
