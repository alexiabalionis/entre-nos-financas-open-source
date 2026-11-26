import type { Transaction } from "@electric-sql/pglite";
import { normalize } from "../domain/finance.ts";
import { merchantKey } from "./assisted.ts";
import { budgetMonthOf, competenceOf, loadCardCompetence } from "./card-competence.ts";
import { pickPayment } from "./recurrence-backfill.ts";
import { readAutoCountedChecking, readBankCardPurchases } from "./realized-spend.ts";

// Conta fixa já paga pelo banco antes de virar lançamento: a compra está na
// fatura do cartão, ou o Pix/débito já saiu (ou está agendado) na conta. O
// gasto já conta pela linha do banco; a ocorrência da conta fixa deixa de ser
// "a pagar" para não contar duas vezes. Só leitura: nada é gravado, e quando a
// linha vira lançamento (ou a fatura é paga) o vínculo normal assume.
// Casamento: mesma conta da série, nome da conta fixa na descrição, valor ±20%,
// até 10 dias da data prevista e, no cartão, a mesma fatura (competência).

export type BankCover = {
  bank_transaction_id: string;
  source: "card" | "checking";
  description: string;
  transaction_date: string;
  cents: string;
};

export type OpenSeriesItem = {
  id: string;
  month: string;
  planned_cents: string;
  category_id: string | null;
  expected_date: string;
  account_id: string | null;
  card: boolean;
  frequency: string;
  match_text: string | null;
  label: string;
};

export type CoverLine = {
  id: string;
  source: BankCover["source"];
  description: string;
  cents: string;
  transaction_date: string;
  account_id: string;
  month: string;
};

const DAY_MS = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

/** Nome que precisa aparecer na linha do banco: a primeira palavra do nome da conta fixa. */
export function coverName(matchText: string | null, label: string): string {
  const word = merchantKey(matchText || label).split(" ")[0] ?? "";
  return word.length >= 3 ? normalize(word) : "";
}

/** Folga de datas: semanal não pode pegar o pagamento da semana vizinha. */
function maxDays(frequency: string): number {
  if (frequency === "day") return 0;
  if (frequency === "week") return 3;
  return 10;
}

const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / DAY_MS;

export function pickCover(item: OpenSeriesItem, lines: readonly CoverLine[], used: Set<string>): CoverLine | null {
  const name = coverName(item.match_text, item.label);
  const days = maxDays(item.frequency);
  const sameAccount = (l: CoverLine) =>
    (item.account_id === null || l.account_id === item.account_id) &&
    (l.source !== "card" || l.month === item.month.slice(0, 7));
  const candidates = name
    ? lines.filter(
        (l) =>
          sameAccount(l) &&
          Math.abs(dayNumber(l.transaction_date) - dayNumber(item.expected_date)) <= days &&
          normalize(l.description).includes(name),
      )
    : [];
  const found = pickPayment(candidates, item, name, used);
  if (found) return candidates.find((l) => l.id === found.id) ?? null;
  // Sem o nome na descrição (Pix para a pessoa, não para "Aulas"): só o valor
  // exato no próprio dia do vencimento conta como o pagamento desta conta.
  return (
    lines.find(
      (l) =>
        !used.has(l.id) &&
        sameAccount(l) &&
        l.cents === item.planned_cents &&
        l.transaction_date === item.expected_date,
    ) ?? null
  );
}

/** Ocorrências em aberto de contas fixas cobertas por uma linha do banco, por item. */
export async function readBankCover(
  tx: Transaction,
  familyId: string,
  months: readonly string[],
): Promise<Map<string, BankCover & { category_id: string | null }>> {
  const cover = new Map<string, BankCover & { category_id: string | null }>();
  if (!months.length) return cover;
  const items = (
    await tx.query<OpenSeriesItem>(
      `SELECT i.id, i.month::text AS month, i.planned_cents::text AS planned_cents, i.category_id,
              COALESCE(i.due_date, o.expected_date)::text AS expected_date, r.account_id, COALESCE(a.kind='card', false) AS card,
              r.frequency, r.match_text, r.label
         FROM monthly_items i
         JOIN recurrence_occurrences o ON o.household_id=i.household_id AND o.monthly_item_id=i.id
         JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
         LEFT JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id
        WHERE i.household_id=$1 AND r.purpose='expense' AND i.purpose='expense'
          AND NOT i.archived AND NOT i.derived AND i.status='open'
          AND i.event_id IS NULL AND i.paid_cents IS NULL AND i.planned_cents IS NOT NULL
          AND i.currency='BRL' AND to_char(i.month,'YYYY-MM')=ANY($2)
        ORDER BY o.expected_date, i.id`,
      [familyId, months],
    )
  ).rows;
  if (!items.length) return cover;
  const dates = items.map((i) => i.expected_date).sort();
  const window = { familyId, from: shift(dates[0], -10), to: shift(dates[dates.length - 1], 11) };
  const competence = await loadCardCompetence(tx, familyId);
  const card: CoverLine[] = (await readBankCardPurchases(tx, window))
    .filter((p) => BigInt(p.amount_cents) < 0n)
    .map((p) => ({
      id: p.id,
      source: "card" as const,
      description: p.description,
      cents: (-BigInt(p.amount_cents)).toString(),
      transaction_date: p.transaction_date,
      account_id: p.local_account_id,
      month: budgetMonthOf(
        competenceOf(competence, {
          account_id: p.local_account_id,
          bank_account_id: p.bank_account_id,
          transaction_date: p.transaction_date,
          card_meta: p.card_meta,
        }),
        p.transaction_date,
      ).month,
    }));
  const checking: CoverLine[] = (await readAutoCountedChecking(tx, window))
    .filter((p) => BigInt(p.amount_cents) < 0n)
    .map((p) => ({
      id: p.id,
      source: "checking" as const,
      description: p.description,
      cents: (-BigInt(p.amount_cents)).toString(),
      transaction_date: p.transaction_date,
      account_id: p.local_account_id,
      month: p.transaction_date.slice(0, 7),
    }));
  const used = new Set<string>();
  for (const item of items) {
    const lines = item.account_id === null ? [...card, ...checking] : item.card ? card : checking;
    const line = pickCover(item, lines, used);
    if (!line) continue;
    used.add(line.id);
    cover.set(item.id, {
      bank_transaction_id: line.id,
      source: line.source,
      description: line.description,
      transaction_date: line.transaction_date,
      cents: line.cents,
      category_id: item.category_id,
    });
  }
  return cover;
}
