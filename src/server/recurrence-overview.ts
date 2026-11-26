import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { readToday } from "./projection.ts";
import { readRecurringAccounts, type RecurringAccount } from "./recurrences.ts";
import { merchantKey } from "./assisted.ts";
import {
  RECURRENCE_COLUMNS,
  generatedItem,
  loadDatesResolver,
  toRule,
  type RecurrenceRow,
} from "./recurrence-sync.ts";
import { occurrencesBetween } from "../domain/recurrence.ts";

// Leitura da tela "Contas fixas": só SELECT, nada é criado nem movido aqui.

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

type OccurrenceRow = {
  recurrence_id: string;
  item_id: string;
  version: number;
  occurrence_date: string;
  due_date: string | null;
  planned_cents: string | null;
  paid_cents: string | null;
  status: string;
  event_id: string | null;
  archived: boolean;
};

const OCCURRENCE_FROM = `FROM recurrence_occurrences o
  JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id`;

// Ocorrência arquivada não conta; conciliada conta pelo valor pago.
function counted(o: OccurrenceRow): bigint {
  if (o.archived) return 0n;
  if (o.event_id !== null && o.paid_cents !== null) return BigInt(o.paid_cents);
  return BigInt(o.planned_cents ?? "0");
}

function isActive(r: RecurrenceRow, today: string): boolean {
  // Encerrada na véspera do início: nunca teve conta, não conta como ativa.
  return !r.paused && (r.end_date === null || (r.end_date >= today && r.end_date >= r.start_date));
}

function nextDate(r: RecurrenceRow, today: string): string | null {
  const reach = new Date(Date.parse(`${today}T00:00:00Z`) + (366 * r.every + 31) * 86_400_000).toISOString().slice(0, 10);
  const through = r.end_date !== null && r.end_date < reach ? r.end_date : reach;
  if (through < today) return null;
  return occurrencesBetween(toRule(r), today, through)[0] ?? null;
}

// Série no cartão: a data é a da cobrança; o pagamento sai com a fatura.
type CardView = { name: string; next_month: string | null; next_due_date: string | null } | null;

// Próxima ocorrência aberta da série (em qualquer mês): é por ela que "Editar"
// abre a conta quando a série não tem nada no mês da tela.
type NextItem = { item_id: string; month: string } | null;

function seriesView(r: RecurrenceRow, today: string, occurrences: OccurrenceRow[], card: CardView = null, next_item: NextItem = null) {
  const next_date = nextDate(r, today);
  return {
    id: r.id,
    label: r.label,
    frequency: r.frequency,
    every: r.every,
    start_date: r.start_date,
    end_date: r.end_date,
    paused: r.paused,
    expected_cents: r.expected_cents,
    next_date,
    card,
    next_item,
    month_cents: occurrences.reduce((sum, o) => sum + counted(o), 0n).toString(),
    occurrences: occurrences.map((o) => ({
      item_id: o.item_id,
      version: o.version,
      occurrence_date: o.occurrence_date,
      due_date: o.due_date,
      planned_cents: o.planned_cents,
      paid_cents: o.paid_cents,
      status: o.status,
      event_id: o.event_id,
      archived: o.archived,
    })),
  };
}

// Sugestão some com "não" ou quando já existe conta fixa com o mesmo
// estabelecimento (e o mesmo cartão), ativa ou já encerrada. O nome vem do
// texto de busca ou, sem ele, do nome da conta, pela mesma chave do histórico
// (merchantKey tira "05/12", cidade e prefixo de Pix), para "ZURICH SEGUROS
// 05/12" bater com a sugestão "Zurich Seguros".
function visibleSuggestions(accounts: RecurringAccount[], series: RecurrenceRow[]) {
  const taken = (a: RecurringAccount) =>
    series.some(
      (r) =>
        merchantKey(r.match_text ?? r.label) === a.merchant_key &&
        (a.scope === "cash" || r.account_id === a.scope),
    );
  // Compra parcelada no cartão não é conta fixa: as parcelas já entram na
  // projeção da fatura (deriveInstallments) e no Futuro.
  const installment = (a: RecurringAccount) => a.installments !== null;
  return accounts
    .filter((a) => a.decision !== "dismiss" && !taken(a) && !installment(a))
    .map((a) => ({ ...a, previously_confirmed: a.decision === "confirm" }));
}

async function readLegacy(tx: Transaction, familyId: string, first: string) {
  const { rows } = await tx.query<{ item_id: string; version: number; label: string; planned_cents: string | null; due_date: string | null; category_id: string | null; status: string }>(
    `SELECT i.id AS item_id, i.version, i.label, i.planned_cents::text AS planned_cents, i.due_date::text AS due_date, i.category_id, i.status
       FROM monthly_items i
      WHERE i.household_id=$1 AND i.month=$2 AND i.purpose='expense' AND i.cost_type='fixed'
        AND NOT i.archived AND NOT i.derived
        AND NOT EXISTS (SELECT 1 FROM recurrence_occurrences o WHERE o.household_id=i.household_id AND o.monthly_item_id=i.id)
      ORDER BY i.label, i.id`,
    [familyId, first],
  );
  return rows;
}

// Item de série em cartão, ainda aberto, cujo mês de hoje (ciclo atual) já não é o gravado.
async function readCardCycleReview(tx: Transaction, familyId: string, today: string, byId: Map<string, RecurrenceRow>) {
  const resolver = await loadDatesResolver(tx, familyId);
  const { rows } = await tx.query<OccurrenceRow & { label: string; month: string }>(
    `SELECT o.recurrence_id, o.monthly_item_id AS item_id, i.version, o.occurrence_date::text AS occurrence_date, i.due_date::text AS due_date,
            i.planned_cents::text AS planned_cents, i.paid_cents::text AS paid_cents, i.status, i.event_id, i.archived, i.label, i.month::text AS month
       ${OCCURRENCE_FROM}
      WHERE o.household_id=$1 AND o.occurrence_date>=$2 AND i.purpose='expense' AND NOT i.archived
        AND i.status='open' AND i.paid_cents IS NULL AND i.event_id IS NULL
      ORDER BY o.occurrence_date, i.id`,
    [familyId, today],
  );
  const review = [];
  for (const o of rows) {
    const r = byId.get(o.recurrence_id);
    const dates = r && resolver(r);
    if (!r || !dates) continue;
    const next = generatedItem(r, o.occurrence_date, dates);
    if (next.month === o.month) continue;
    review.push({
      item_id: o.item_id,
      version: o.version,
      label: o.label,
      current_month: o.month.slice(0, 7),
      suggested_month: next.month.slice(0, 7),
      suggested_due_date: next.due_date !== null && next.due_date.slice(0, 7) === next.month.slice(0, 7) ? next.due_date : null,
    });
  }
  return review;
}

export async function readFixedOverview(db: Database, user: Identity, raw: unknown, opts: { today?: string } = {}) {
  const { month } = monthSchema.parse(raw);
  const first = `${month}-01`;
  const accounts = await readRecurringAccounts(db, user, opts);
  return asUser(db, user.userId, async (tx) => {
    const today = opts.today ?? (await readToday(tx));
    const { rows: series } = await tx.query<RecurrenceRow>(
      `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND purpose='expense' ORDER BY label, id`,
      [user.familyId],
    );
    const { rows: occurrences } = await tx.query<OccurrenceRow>(
      `SELECT o.recurrence_id, o.monthly_item_id AS item_id, i.version, o.occurrence_date::text AS occurrence_date, i.due_date::text AS due_date,
              i.planned_cents::text AS planned_cents, i.paid_cents::text AS paid_cents, i.status, i.event_id, i.archived
         ${OCCURRENCE_FROM}
        WHERE o.household_id=$1 AND i.month=$2 AND i.purpose='expense'
        ORDER BY o.occurrence_date, i.id`,
      [user.familyId, first],
    );
    const active = series.filter((r) => isActive(r, today));
    const resolver = await loadDatesResolver(tx, user.familyId);
    const { rows: cards } = await tx.query<{ id: string; name: string }>(
      "SELECT id, name FROM accounts WHERE household_id=$1 AND kind='card'",
      [user.familyId],
    );
    const cardName = new Map(cards.map((c) => [c.id, c.name]));
    const cardOf = (r: RecurrenceRow): CardView => {
      const name = r.account_id === null ? undefined : cardName.get(r.account_id);
      if (name === undefined) return null;
      const next = nextDate(r, today);
      const dates = resolver(r);
      const bill = next !== null && dates ? generatedItem(r, next, dates) : null;
      return { name, next_month: bill ? bill.month.slice(0, 7) : null, next_due_date: bill?.due_date ?? null };
    };
    // Editar "a partir de" fecha a série e cria outra (replaces_id). A tela mostra
    // só a versão mais nova; o que ficou realizado nas antigas aparece nela, e o
    // que a edição arquivou some (não foi pulado pela família, foi substituído).
    const { rows: links } = await tx.query<{ id: string; replaces_id: string }>(
      "SELECT id, replaces_id FROM recurrences WHERE household_id=$1 AND purpose='expense' AND replaces_id IS NOT NULL",
      [user.familyId],
    );
    const successor = new Map(links.map((l) => [l.replaces_id, l.id]));
    const headOf = (id: string) => {
      const seen = new Set<string>();
      while (successor.has(id) && !seen.has(id)) {
        seen.add(id);
        id = successor.get(id)!;
      }
      return id;
    };
    const { rows: upcoming } = await tx.query<{ recurrence_id: string; item_id: string; month: string }>(
      `SELECT DISTINCT ON (o.recurrence_id) o.recurrence_id, o.monthly_item_id AS item_id, to_char(i.month, 'YYYY-MM') AS month
         ${OCCURRENCE_FROM}
        WHERE o.household_id=$1 AND o.occurrence_date>=$2 AND i.purpose='expense' AND NOT i.archived AND NOT i.derived
          AND i.status='open' AND i.paid_cents IS NULL AND i.event_id IS NULL
        ORDER BY o.recurrence_id, o.occurrence_date, i.id`,
      [user.familyId, today],
    );
    const nextItem = new Map(upcoming.map((u) => [u.recurrence_id, { item_id: u.item_id, month: u.month }]));
    const shown = (r: RecurrenceRow) =>
      occurrences.filter((o) => headOf(o.recurrence_id) === r.id && (o.recurrence_id === r.id || !o.archived));
    return {
      total_cents: occurrences.reduce((sum, o) => sum + counted(o), 0n).toString(),
      active: active.length,
      // Encerrada antes do início (a pessoa removeu): não tem conta nenhuma, sai da lista.
      series: series
        .filter((r) => !successor.has(r.id) && !(r.end_date !== null && r.end_date < r.start_date))
        .map((r) => seriesView(r, today, shown(r), cardOf(r), nextItem.get(r.id) ?? null)),
      suggestions: visibleSuggestions(accounts, series),
      legacy: await readLegacy(tx, user.familyId, first),
      card_cycle_review: await readCardCycleReview(tx, user.familyId, today, new Map(series.map((r) => [r.id, r]))),
    };
  });
}
