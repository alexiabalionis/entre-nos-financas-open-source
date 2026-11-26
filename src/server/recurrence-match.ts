import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import type { Frequency } from "../domain/recurrence.ts";
import { withinTolerance } from "../domain/everyday-bill-match.ts";

export type SeriesContext = {
  account_id: string | null;
  card: boolean;
  /** Nome do cartão quando a série é cobrada num cartão; null fora dele. */
  card_name: string | null;
  id: string;
  frequency: Frequency;
  every: number;
  start_date: string;
  /** Último dia da série; null quando não tem fim. */
  end_date: string | null;
  occurrence_date: string;
};
export type ItemRecurrence = Pick<
  SeriesContext,
  "id" | "frequency" | "every" | "start_date" | "end_date" | "occurrence_date" | "card_name"
>;
export type EventCandidate = {
  id: string;
  description: string;
  amount_cents: string;
  currency: string;
  kind: string;
  transaction_date: string;
};
export type SuggestItem = {
  id: string;
  month: string;
  currency: string;
  purpose: string;
  planned_cents: string | null;
  due_date: string | null;
};

const SERIES_SUGGESTIONS = 6;
const SEARCH_LIMIT = 50;
const SERIES_KINDS = ["expense", "fee", "card_purchase", "income", "yield"];

/** Tipos de transação que podem conciliar um item; série no cartão só aceita compra. */
export function allowedEventKinds(
  purpose: string,
  series: SeriesContext | null,
): string[] {
  if (purpose === "income") return ["income", "yield"];
  if (purpose === "card") return ["card_payment"];
  if (purpose === "saving") return ["transfer", "investment_buy"];
  if (series) return series.card ? ["card_purchase"] : ["expense", "fee"];
  return ["expense", "fee", "card_purchase"];
}

export async function loadSeriesContexts(
  tx: Transaction,
  familyId: string,
  itemIds: string[],
): Promise<Map<string, SeriesContext>> {
  const contexts = new Map<string, SeriesContext>();
  if (!itemIds.length) return contexts;
  const { rows } = await tx.query<SeriesContext & { item_id: string }>(
    `SELECT o.monthly_item_id AS item_id, r.account_id, COALESCE(a.kind='card', false) AS card, CASE WHEN a.kind='card' THEN a.name END AS card_name,
            r.id, r.frequency, r.every, r.start_date::text AS start_date, r.end_date::text AS end_date, o.occurrence_date::text AS occurrence_date
       FROM recurrence_occurrences o
       JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       LEFT JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id
      WHERE o.household_id=$1 AND r.purpose='expense' AND o.monthly_item_id = ANY($2::uuid[])`,
    [familyId, itemIds],
  );
  for (const { item_id, ...context } of rows) contexts.set(item_id, context);
  return contexts;
}

const absCents = (value: string) => {
  const n = BigInt(value);
  return n < 0n ? -n : n;
};
const dayNumber = (date: string) =>
  Date.parse(date + "T00:00:00Z") / 86_400_000;

type WindowEvent = EventCandidate & { linked_to: string | null };

/** Sugestões para itens de série: mês anterior, atual e seguinte, valor até ±20% do previsto. */
export async function suggestForSeriesItems(
  tx: Transaction,
  familyId: string,
  month: string,
  items: SuggestItem[],
  contexts: Map<string, SeriesContext>,
): Promise<Map<string, EventCandidate[]>> {
  const result = new Map<string, EventCandidate[]>();
  if (!items.length) return result;
  const first = month + "-01";
  const { rows } = await tx.query<WindowEvent>(
    `SELECT e.id,e.description,e.amount_cents::text,e.currency,e.kind::text AS kind,e.transaction_date::text,
            (SELECT m.id FROM monthly_items m WHERE m.household_id=e.household_id AND m.event_id=e.id AND NOT m.archived LIMIT 1) AS linked_to
       FROM economic_events e
      WHERE e.household_id=$1 AND e.kind::text = ANY($3::text[])
        AND e.transaction_date >= ($2::date - interval '1 month')
        AND e.transaction_date < ($2::date + interval '2 months')`,
    [familyId, first, SERIES_KINDS],
  );
  for (const item of items) {
    if (item.planned_cents === null) continue;
    const planned = BigInt(item.planned_cents);
    const kinds = allowedEventKinds(
      item.purpose,
      contexts.get(item.id) ?? null,
    );
    const reference = dayNumber(item.due_date ?? item.month);
    const ranked = rows
      .filter((e) => {
        if (e.currency !== item.currency || !kinds.includes(e.kind))
          return false;
        if (e.linked_to !== null && e.linked_to !== item.id) return false;
        return withinTolerance(absCents(e.amount_cents), planned);
      })
      .map((e) => {
        const diff = absCents(e.amount_cents) - planned;
        return {
          e,
          days: Math.abs(dayNumber(e.transaction_date) - reference),
          value: diff < 0n ? -diff : diff,
        };
      })
      .sort(
        (a, b) =>
          a.days - b.days ||
          (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
      )
      .slice(0, SERIES_SUGGESTIONS)
      .map(({ e }) => ({
        id: e.id,
        description: e.description,
        amount_cents: e.amount_cents,
        currency: e.currency,
        kind: e.kind,
        transaction_date: e.transaction_date,
      }));
    result.set(item.id, ranked);
  }
  return result;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const searchSchema = z
  .object({
    item_id: z.uuid(),
    q: z.string().trim().max(120).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();

/** Busca manual, só leitura: sem limite de data, mesma família, moeda e tipo compatíveis. */
export async function searchCandidates(
  db: Database,
  user: Identity,
  raw: unknown,
): Promise<EventCandidate[]> {
  const input = searchSchema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const item = (
      await tx.query<{ id: string; purpose: string; currency: string }>(
        "SELECT id,purpose,currency FROM monthly_items WHERE household_id=$1 AND id=$2 AND NOT archived",
        [user.familyId, input.item_id],
      )
    ).rows[0];
    if (!item) throw new UserError("Item indisponível.");
    const series =
      (await loadSeriesContexts(tx, user.familyId, [item.id])).get(item.id) ??
      null;
    const pattern = input.q
      ? "%" + input.q.replace(/[\\%_]/g, "\\$&") + "%"
      : null;
    const { rows } = await tx.query<EventCandidate>(
      `SELECT e.id,e.description,e.amount_cents::text,e.currency,e.kind::text AS kind,e.transaction_date::text
         FROM economic_events e
        WHERE e.household_id=$1 AND e.currency=$2 AND e.kind::text = ANY($3::text[])
          AND ($4::text IS NULL OR e.description ILIKE $4)
          AND ($5::date IS NULL OR e.transaction_date >= $5::date)
          AND ($6::date IS NULL OR e.transaction_date <= $6::date)
          AND NOT EXISTS (SELECT 1 FROM monthly_items m WHERE m.household_id=e.household_id AND m.event_id=e.id AND NOT m.archived AND m.id<>$7)
        ORDER BY e.transaction_date DESC, e.id
        LIMIT ${SEARCH_LIMIT}`,
      [
        user.familyId,
        item.currency,
        allowedEventKinds(item.purpose, series),
        pattern,
        input.from ?? null,
        input.to ?? null,
        item.id,
      ],
    );
    return rows;
  });
}
