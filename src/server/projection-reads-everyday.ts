import type { Transaction } from "@electric-sql/pglite";
import { WEEKS_WINDOW, weeklyRate, weeklyTotals } from "../domain/everyday.ts";
import { addDays, mondayOf } from "../domain/day.ts";
import { readRealizedSpend, type RealizedSpend } from "./realized-spend.ts";
import { fixedEventIds, reconciledEventIds } from "./fixed-events.ts";
import { matchProbablePayments, type OpenBill } from "../domain/everyday-bill-match.ts";
import { merchantKey } from "./assisted.ts";

// Ritmo de sempre do dia a dia (referência do Copiloto): mediana das 8
// semanas completas antes da semana de hoje, somando conta e cartão pela data
// da compra. Fica de fora o que já está nas contas previstas, para não contar
// duas vezes: gastos conciliados a uma conta fixa, gastos de uma série ainda
// não conciliados (par cartão/dinheiro + texto do extrato), gastos conciliados
// a qualquer item planejado e o pagamento provável de uma conta avulsa em
// aberto do mês (um gasto por conta). O resto da categoria conta. Só leitura,
// por família.

type Excluded = "fixed" | "bill" | "recurring" | "installment" | null;
type Classified = RealizedSpend & { excluded: Excluded };
type Input = {
  familyId: string;
  today: string;
  declaredWeekly?: bigint | null;
  // Só o Futuro: parcela de compra parcelada já está na fatura, então sai do ritmo.
  excludeInstallments?: boolean;
};

// Pares (scope, texto do extrato) das séries de despesa ativas. scope = id do
// cartão ou 'cash', a mesma chave de readRealizedSpend.
async function readSeriesPairs(
  tx: Transaction,
  p: { familyId: string; today: string },
): Promise<Set<string>> {
  const rows = (
    await tx.query<{ scope: string; match_text: string }>(
      `SELECT CASE WHEN a.kind='card' THEN a.id::text ELSE 'cash' END AS scope,r.match_text
       FROM recurrences r
       LEFT JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id
       WHERE r.household_id=$1 AND r.purpose='expense' AND NOT r.paused
         AND r.match_text IS NOT NULL
         AND (r.end_date IS NULL OR r.end_date>=$2::date)`,
      [p.familyId, p.today],
    )
  ).rows;
  return new Set(rows.map((r) => `${r.scope}\u0000${merchantKey(r.match_text)}`));
}

// Contas de despesa do mês ainda em aberto e sem lançamento conciliado.
async function readOpenBills(
  tx: Transaction,
  p: { familyId: string; month: string },
): Promise<OpenBill[]> {
  const rows = (
    await tx.query<{ id: string; name: string; remaining: string; due: string | null }>(
      `SELECT m.id::text AS id,c.name,(m.planned_cents-coalesce(m.paid_cents,0))::text AS remaining,
              m.due_date::text AS due
       FROM monthly_items m
       JOIN categories c ON c.household_id=m.household_id AND c.id=m.category_id
       WHERE m.household_id=$1 AND to_char(m.month,'YYYY-MM')=$2
         AND NOT m.derived AND NOT m.archived AND m.purpose='expense'
         AND m.status<>'done' AND m.event_id IS NULL
         AND m.planned_cents>coalesce(m.paid_cents,0)`,
      [p.familyId, p.month],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    month: p.month,
    category: r.name,
    remaining: BigInt(r.remaining),
    due: r.due,
  }));
}

async function classifySpend(tx: Transaction, p: Input) {
  const to = mondayOf(p.today);
  const from = addDays(to, -7 * WEEKS_WINDOW);
  const [spend, openBills, pairs] = await Promise.all([
    readRealizedSpend(tx, { familyId: p.familyId, from, to }),
    readOpenBills(tx, { familyId: p.familyId, month: p.today.slice(0, 7) }),
    readSeriesPairs(tx, { familyId: p.familyId, today: p.today }),
  ]);
  const eventIds = spend.flatMap((r) => (r.eventId ? [r.eventId] : []));
  const [fixedEvents, reconciled] = await Promise.all([
    fixedEventIds(tx, p.familyId, eventIds),
    reconciledEventIds(tx, p.familyId, eventIds),
  ]);
  const probable = matchProbablePayments(
    openBills,
    spend.map((r, i) => ({
      key: String(i),
      date: r.date,
      category: r.categoryName,
      cents: r.cents,
    })),
  );
  const rows: Classified[] = spend.map((r, i) => ({
    ...r,
    excluded:
      p.excludeInstallments && r.installment
        ? "installment"
        : r.eventId !== null && fixedEvents.has(r.eventId)
          ? "fixed"
          : pairs.has(`${r.scope}\u0000${r.merchant}`)
            ? "recurring"
            : (r.eventId !== null && reconciled.has(r.eventId)) || probable.has(String(i))
              ? "bill"
              : null,
  }));
  return { from, rows };
}

const median = (rows: readonly Classified[], from: string) =>
  weeklyRate(
    weeklyTotals({ rows: rows.map((r) => ({ date: r.date, cents: r.cents })), windowStart: from }),
  )?.nom ?? null;

/**
 * Quanto do dia a dia passa pelo cartão, em pontos-base (0 a 10.000), pelos
 * mesmos gastos que entram no ritmo. O Futuro usa para tirar da conta a parte
 * do cartão só no vencimento da fatura, não no dia da compra.
 */
export async function readUsualCardShare(tx: Transaction, p: Input): Promise<number> {
  const { rows } = await classifySpend(tx, p);
  const included = rows.filter((r) => r.excluded === null);
  const total = included.reduce((s, r) => s + r.cents, 0n);
  if (total <= 0n) return 0;
  const card = included.filter((r) => r.scope !== "cash").reduce((s, r) => s + r.cents, 0n);
  const bp = Number((card * 10000n) / total);
  return Math.max(0, Math.min(10000, bp));
}

export async function readUsualWeekly(tx: Transaction, p: Input): Promise<bigint | null> {
  const { from, rows } = await classifySpend(tx, p);
  return median(rows.filter((r) => r.excluded === null), from) ?? p.declaredWeekly ?? null;
}

// Raio-x do ritmo de sempre (só leitura, para conferir o número): o que entra,
// o que ficou de fora e por quê, e o ritmo simulado sem o gasto sem categoria.
// weekly de cada grupo = total nas 8 semanas / 8 (a mediana não se reparte).
export async function readUsualBreakdown(tx: Transaction, p: Input) {
  const { from, rows } = await classifySpend(tx, p);
  const included = rows.filter((r) => r.excluded === null);
  const groups = new Map<string, { label: string; categorized: boolean; excluded: Excluded; total: bigint; count: number }>();
  for (const r of rows) {
    const label = r.categoryName ?? `Sem categoria: ${r.merchant}`;
    const key = `${r.excluded ?? "in"}\u0000${label}`;
    const g = groups.get(key) ?? { label, categorized: r.categoryName !== null, excluded: r.excluded, total: 0n, count: 0 };
    g.total += r.cents;
    g.count += 1;
    groups.set(key, g);
  }
  const list = [...groups.values()]
    .sort((a, b) => (a.total < b.total ? 1 : a.total > b.total ? -1 : 0))
    .map((g) => ({
      label: g.label,
      excluded: g.excluded,
      count: g.count,
      total_cents: g.total.toString(),
      weekly_cents: (g.total / BigInt(WEEKS_WINDOW)).toString(),
    }));
  const big = (v: bigint | null) => (v === null ? null : v.toString());
  return {
    window: { from, to: mondayOf(p.today) },
    usual_weekly_cents: big(median(included, from)),
    simulated: {
      without_uncategorized_cents: big(median(included.filter((r) => r.categoryName !== null), from)),
      without_any_exclusion_cents: big(median(rows, from)),
    },
    included: list.filter((g) => g.excluded === null).slice(0, 15),
    excluded: list.filter((g) => g.excluded !== null).slice(0, 15),
  };
}
