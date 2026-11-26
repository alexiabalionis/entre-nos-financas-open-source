import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { occurrencesBetween } from "../domain/recurrence.ts";
import { withinTolerance } from "../domain/everyday-bill-match.ts";
import { normalize } from "../domain/finance.ts";
import {
  generatedItem,
  horizonEnd,
  insertOccurrence,
  loadDatesResolver,
  syncSeries,
  toRule,
  type DatesResolver,
  type GeneratedItem,
  type RecurrenceRow,
} from "./recurrence-sync.ts";

// Meses ANTES do mês atual: a conta já passou. Cada ocorrência que falta vira um
// item pago. Se houver um pagamento real parecido (valor ±20%, até 10 dias da
// data prevista, mesma conta) e livre, o item fica ligado a ele e o gasto conta
// uma vez. Sem pagamento, o item fica "pago sem lançamento associado".

const MATCH_DAYS = 10;
const DAY_MS = 86_400_000;

type Candidate = {
  id: string;
  description: string;
  cents: string;
  transaction_date: string;
};

const day = (date: string) => Date.parse(date + "T00:00:00Z") / DAY_MS;

function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

async function loadCandidates(tx: Transaction, r: RecurrenceRow, from: string, through: string): Promise<Candidate[]> {
  const { rows } = await tx.query<Candidate>(
    `SELECT e.id, e.description, abs(e.amount_cents)::text AS cents, e.transaction_date::text AS transaction_date
       FROM economic_events e
       LEFT JOIN accounts a ON a.household_id=e.household_id AND a.id=e.account_id
      WHERE e.household_id=$1 AND e.currency='BRL' AND e.amount_cents<0
        AND e.kind::text = ANY(CASE WHEN COALESCE(a.kind='card', false) THEN ARRAY['card_purchase'] ELSE ARRAY['expense','fee'] END)
        AND ($2::uuid IS NULL OR e.account_id=$2)
        AND e.transaction_date BETWEEN $3::date AND $4::date
        AND NOT EXISTS (SELECT 1 FROM monthly_items m WHERE m.household_id=e.household_id AND m.event_id=e.id AND NOT m.archived)`,
    [r.household_id, r.account_id, from, through],
  );
  return rows;
}

/** Melhor pagamento livre para a ocorrência: nome parecido primeiro, depois data e valor. */
export function pickPayment(
  candidates: Candidate[],
  item: Pick<GeneratedItem, "expected_date" | "planned_cents">,
  matchText: string | null,
  used: Set<string>,
): Candidate | null {
  if (item.planned_cents === null) return null;
  const planned = BigInt(item.planned_cents);
  const key = matchText ? normalize(matchText) : "";
  const ranked = candidates
    .filter((c) => !used.has(c.id))
    .filter((c) => Math.abs(day(c.transaction_date) - day(item.expected_date)) <= MATCH_DAYS)
    .filter((c) => withinTolerance(BigInt(c.cents), planned))
    .map((c) => {
      const diff = BigInt(c.cents) - planned;
      return {
        c,
        named: key !== "" && normalize(c.description).includes(key) ? 0 : 1,
        days: Math.abs(day(c.transaction_date) - day(item.expected_date)),
        value: diff < 0n ? -diff : diff,
      };
    })
    .sort((a, b) => a.named - b.named || a.days - b.days || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return ranked[0]?.c ?? null;
}

async function insertPaidItem(tx: Transaction, userId: string, r: RecurrenceRow, item: GeneratedItem, payment: Candidate | null) {
  const itemId = randomUUID();
  await tx.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,status,paid_cents,paid_date,event_id,created_by)
     VALUES($1,$2,$3,$4,$5,'BRL',$6,$7,$8,'done',$9,$10,$11,$12)`,
    [
      itemId, r.household_id, item.month, item.label, item.purpose, item.planned_cents, item.category_id, item.due_date,
      payment ? payment.cents : item.planned_cents,
      payment ? payment.transaction_date : (item.due_date ?? item.expected_date),
      payment?.id ?? null,
      userId,
    ],
  );
  return itemId;
}

/** Cria as ocorrências que faltam do início da série até o fim do mês anterior a `today`. */
export async function backfillPast(
  tx: Transaction,
  userId: string,
  r: RecurrenceRow,
  today: string,
  resolver: DatesResolver,
): Promise<{ created: number; linked: number }> {
  const through = addDays(today.slice(0, 7) + "-01", -1);
  if (r.purpose !== "expense" || r.start_date > through) return { created: 0, linked: 0 };
  const dates = resolver(r);
  const { rows } = await tx.query<{ d: string }>(
    `SELECT occurrence_date::text AS d FROM recurrence_occurrences
      WHERE household_id=$1 AND recurrence_id=$2 AND occurrence_date BETWEEN $3 AND $4`,
    [r.household_id, r.id, r.start_date, through],
  );
  const have = new Set(rows.map((row) => row.d));
  const missing = occurrencesBetween(toRule(r), r.start_date, through).filter((d) => !have.has(d));
  if (!missing.length) return { created: 0, linked: 0 };
  const candidates = await loadCandidates(tx, r, addDays(missing[0], -MATCH_DAYS), addDays(missing[missing.length - 1], MATCH_DAYS));
  const used = new Set<string>();
  let linked = 0;
  for (const date of missing) {
    const item = generatedItem(r, date, dates);
    const payment = pickPayment(candidates, item, r.match_text, used);
    if (payment) {
      used.add(payment.id);
      linked++;
    }
    await insertOccurrence(tx, r, date, item.expected_date, await insertPaidItem(tx, userId, r, item, payment));
  }
  return { created: missing.length, linked };
}

/** Passado pago (backfill) e, do mês atual em diante, os itens previstos de sempre. */
export async function populateSeries(
  tx: Transaction,
  userId: string,
  r: RecurrenceRow,
  today: string,
  resolver?: DatesResolver,
): Promise<number> {
  const resolve = resolver ?? (await loadDatesResolver(tx, r.household_id));
  const past = await backfillPast(tx, userId, r, today, resolve);
  const monthStart = today.slice(0, 7) + "-01";
  const from = r.start_date > monthStart ? r.start_date : monthStart;
  return past.created + (await syncSeries(tx, userId, r, from, horizonEnd(today), resolve));
}
