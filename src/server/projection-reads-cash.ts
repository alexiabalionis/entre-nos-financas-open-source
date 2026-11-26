import type { Transaction } from "@electric-sql/pglite";
import { includedInCashSql } from "./projection-reads.ts";
import { diffDays } from "../domain/day.ts";

// F1a do Copiloto (leituras de caixa): saldo conservador (sConf), configuração
// financeira da família e a defasagem (staleness) do saldo. Toda leitura é por
// família (RLS cuida do escopo); nada aqui registra lançamento.

// sConf: saldo das contas incluídas no caixa e a data do snapshot (menor data
// de leitura entre elas). Prioridade por conta: saldo do banco conectado
// (bank_accounts BANK ligado, data = read_at); senão balance_confirmed_*;
// senão abertura + ledger. Conta sem nenhum saldo vira lacuna 'unbounded'.
export type CashSnapshot = {
  sConf: bigint;
  snapshotDate: string | null;
  unbounded: { key: string; reason: string }[];
  /** Saldo de cada conta que entrou em sConf (a soma é sConf), com a data da leitura. */
  accounts: { id: string; name: string; cents: bigint; date: string | null }[];
};

type CashRow = {
  id: string;
  name: string;
  opening_cents: string | null;
  balance_confirmed_cents: string | null;
  balance_confirmed_at: string | null;
  ledger_cents: string;
  bank_balance_cents: string | null;
  bank_read_at: string | null;
};

export async function readCashSnapshot(
  tx: Transaction,
  familyId: string,
): Promise<CashSnapshot> {
  const rows = (
    await tx.query<CashRow>(
      `SELECT a.id,a.name,a.opening_cents::text,a.balance_confirmed_cents::text,a.balance_confirmed_at::text,
        coalesce(sum(l.amount_cents),0)::text AS ledger_cents,
        bk.balance_cents::text AS bank_balance_cents,bk.read_at::text AS bank_read_at
       FROM accounts a
       LEFT JOIN ledger_entries l ON l.account_id=a.id
       LEFT JOIN LATERAL (
         SELECT ba.balance_cents,ba.read_at::date::text AS read_at
         FROM bank_accounts ba
         WHERE ba.household_id=a.household_id AND ba.local_account_id=a.id
           AND ba.account_type='BANK' AND ba.active AND ba.balance_cents IS NOT NULL
         ORDER BY ba.read_at DESC LIMIT 1
       ) bk ON true
       WHERE a.household_id=$1 AND ${includedInCashSql("a")}
       GROUP BY a.id,a.name,bk.balance_cents,bk.read_at
       ORDER BY a.id`,
      [familyId],
    )
  ).rows;
  let sConf = 0n;
  let snapshotDate: string | null = null;
  const unbounded: { key: string; reason: string }[] = [];
  const accounts: CashSnapshot["accounts"] = [];
  for (const r of rows) {
    let balance: bigint | null = null;
    let date: string | null = null;
    if (r.bank_balance_cents !== null) {
      balance = BigInt(r.bank_balance_cents);
      date = r.bank_read_at;
    } else if (r.balance_confirmed_cents !== null) {
      balance = BigInt(r.balance_confirmed_cents);
      date = r.balance_confirmed_at;
    } else if (r.opening_cents !== null) {
      balance = BigInt(r.opening_cents) + BigInt(r.ledger_cents);
      // Abertura+ledger não tem data de leitura própria; não define snapshot.
    }
    if (balance === null) {
      unbounded.push({
        key: `saldo:${r.id}`,
        reason: "Conta incluída no caixa sem saldo informado.",
      });
      continue;
    }
    sConf += balance;
    accounts.push({ id: r.id, name: r.name, cents: balance, date });
    if (date !== null && (snapshotDate === null || date < snapshotDate))
      snapshotDate = date;
  }
  return { sConf, snapshotDate, unbounded, accounts };
}

// Configuração financeira da família para o motor: colchão (cushion) e a
// declaração de "não tenho renda". Sem linha configurada, cushion 0 e declaração
// falsa (padrão da migration).
export type FinanceSettings = {
  cushion: bigint;
  noIncomeDeclared: boolean;
  everydayWeekly: bigint | null;
  // Margem do Copiloto escolhida pela pessoa; null = ainda não escolheu.
  copilotMargin: bigint | null;
};

const big = (v: string | null | undefined) => (v == null ? null : BigInt(v));

export async function readFinanceSettings(
  tx: Transaction,
  familyId: string,
): Promise<FinanceSettings> {
  const row = (
    await tx.query<{
      cushion_cents: string;
      no_income_declared: boolean;
      everyday_weekly_cents: string | null;
      copilot_margin_cents: string | null;
    }>(
      "SELECT cushion_cents::text,no_income_declared,everyday_weekly_cents::text,copilot_margin_cents::text FROM household_finance_settings WHERE household_id=$1",
      [familyId],
    )
  ).rows[0];
  return {
    cushion: row ? BigInt(row.cushion_cents) : 0n,
    noIncomeDeclared: row?.no_income_declared ?? false,
    everydayWeekly: big(row?.everyday_weekly_cents),
    copilotMargin: big(row?.copilot_margin_cents),
  };
}

// Defasagem do saldo (staleness): days = today - snapshotDate (null quando não
// há snapshot ou days<=0). dailyRate (conservador) = MAIOR soma semanal
// (segunda a domingo) de despesa BRL — eventos expense/fee/card_purchase em
// contas incluídas no caixa e em cartões — nas 12 SEMANAS COMPLETAS antes de
// today, dividida por 7 (floor). A semana parcial que contém today fica de fora;
// pegar o pico semanal (não a média) projeta a defasagem pelo ritmo de gasto
// mais apertado, não pelo médio.
export async function stalenessFrom(
  tx: Transaction,
  familyId: string,
  snapshotDate: string | null,
  today: string,
): Promise<{ days: number; dailyRate: bigint } | null> {
  if (snapshotDate === null) return null;
  const days = diffDays(snapshotDate, today);
  if (days <= 0) return null;
  // weekEnd exclusivo = segunda-feira da semana que contém today (isodow: 1=seg
  // .. 7=dom; today - (isodow-1) dias). weekStart = 12 semanas antes. Só eventos
  // em [weekStart, weekEnd) entram, agrupados por segunda da sua semana.
  const row = (
    await tx.query<{ max_week: string }>(
      `WITH bounds AS (
         SELECT ($2::date-(extract(isodow FROM $2::date)::int-1)) AS week_end
       ),
       weekly AS (
         SELECT date_trunc('week',e.transaction_date)::date AS week_start,
           sum(-e.amount_cents) AS spent
         FROM economic_events e JOIN accounts a ON a.id=e.account_id
         CROSS JOIN bounds b
         WHERE e.household_id=$1 AND e.currency='BRL'
           AND e.kind IN ('expense','fee','card_purchase')
           AND (${includedInCashSql("a")} OR a.kind='card')
           AND e.transaction_date>=b.week_end-make_interval(weeks=>12)
           AND e.transaction_date<b.week_end
         GROUP BY week_start
       )
       SELECT coalesce(max(spent),0)::text AS max_week FROM weekly`,
      [familyId, today],
    )
  ).rows[0];
  const maxWeek = BigInt(row.max_week);
  const dailyRate = maxWeek > 0n ? maxWeek / 7n : 0n;
  return { days, dailyRate };
}
