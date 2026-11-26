import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { cents, dateOnly } from "../domain/finance.ts";
import { eventName } from "../domain/event-name.ts";
import { UserError } from "./imports.ts";
import {
  allowedEventKinds,
  loadSeriesContexts,
  suggestForSeriesItems,
  type ItemRecurrence,
  type SeriesContext,
} from "./recurrence-match.ts";
import {
  loadCardCompetence,
  readCardEvents,
} from "./card-competence.ts";
import { readBankCover, type BankCover } from "./fixed-bank-cover.ts";

const coverView = (c: (BankCover & { category_id: string | null }) | undefined): BankCover | null =>
  c
    ? {
        bank_transaction_id: c.bank_transaction_id,
        source: c.source,
        description: c.description,
        transaction_date: c.transaction_date,
        cents: c.cents,
      }
    : null;
export type MonthlyItem = {
  id: string;
  month: string;
  label: string;
  purpose: string;
  cost_type?: "fixed" | "variable" | null;
  currency: string;
  planned_cents: string | null;
  paid_cents: string | null;
  actual_reference_cents: string | null;
  status: string;
  due_date: string | null;
  paid_date: string | null;
  notes: string;
  source_note: string;
  source_line_id: string | null;
  category_id: string | null;
  event_id: string | null;
  derived: boolean;
  version: number;
  /** Conta fixa já paga pelo banco (fatura ou Pix), ainda sem lançamento ligado. */
  bank_cover?: BankCover | null;
  funding?: {
    expected_date: string;
    receipt_mode?: string;
    received_date: string | null;
    state: string;
    note: string;
    bank_transaction_id: string | null;
  };
};
export const itemSchema = z
  .object({
    id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    label: z.string().trim().min(1).max(180),
    purpose: z.enum(["expense", "income", "saving", "card", "benefit"]),
    currency: z.enum(["BRL", "USD", "EUR"]),
    cost_type: z.enum(["fixed", "variable"]).nullable().optional(),
    amount: z.string().max(30),
    due_date: z.string().nullable(),
    category_id: z.uuid().nullable().default(null),
    notes: z.string().max(1000).default(""),
  })
  .strict();
const itemRecurrence = (
  c: SeriesContext | undefined,
): ItemRecurrence | null =>
  c
    ? {
        id: c.id,
        frequency: c.frequency,
        every: c.every,
        start_date: c.start_date,
        end_date: c.end_date,
        occurrence_date: c.occurrence_date,
        card_name: c.card_name,
      }
    : null;
export async function readRoutine(db: Database, user: Identity, month: string) {
  dateOnly(month + "-01");
  return asUser(db, user.userId, async (tx) => {
    // Competência e eventos de cartão do mês, lidos UMA vez e reutilizados
    // nos candidatos a baixa do plano.
    const cardCtx = await loadCardCompetence(tx, user.familyId);
    const cardEvents = await readCardEvents(tx, cardCtx, {
      familyId: user.familyId,
      month: month + "-01",
      currency: "BRL",
    });
    const items = (
      await tx.query<MonthlyItem>(
        `SELECT id,month::text,label,purpose,cost_type,currency,planned_cents::text,paid_cents::text,actual_reference_cents::text,status,due_date::text,paid_date::text,notes,source_note,source_line_id,category_id,event_id,derived,version FROM monthly_items WHERE household_id=$1 AND month=$2 AND NOT archived ORDER BY status='done',due_date NULLS LAST,label`,
        [user.familyId, month + "-01"],
      )
    ).rows;
    const funding = (
      await tx.query<{
        monthly_item_id: string;
        receipt_mode: string;
        expected_date: string;
        received_date: string | null;
        state: string;
        note: string;
        bank_transaction_id: string | null;
      }>(
        `SELECT CASE r.date_rule WHEN 'fifth_business_day' THEN 'business_window' ELSE 'fixed' END AS receipt_mode,o.monthly_item_id,o.expected_date::text,b.transaction_date::text AS received_date,o.match_state AS state,o.match_note AS note,o.match_bank_transaction_id AS bank_transaction_id FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id LEFT JOIN bank_transactions b ON b.id=o.match_bank_transaction_id WHERE o.household_id=$1 AND i.month=$2 AND r.purpose='income' AND NOT r.paused AND NOT i.archived`,
        [user.familyId, month + "-01"],
      )
    ).rows;
    const candidates = (
      await tx.query<{
        id: string;
        description: string;
        amount_cents: string;
        currency: string;
        kind: string;
        transaction_date: string;
      }>(
        `SELECT e.id,e.description,e.amount_cents::text,e.currency,e.kind,e.transaction_date::text FROM economic_events e JOIN accounts a ON a.id=e.account_id WHERE e.household_id=$1 AND ((a.kind<>'card' AND e.transaction_date>=$2::date AND e.transaction_date<($2::date+interval '1 month')) OR e.id IN (SELECT b.event_id FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id JOIN bank_transactions b ON b.id=o.match_bank_transaction_id WHERE o.household_id=$1 AND r.purpose='income' AND i.month=$2 AND NOT i.archived))`,
        [user.familyId, month + "-01"],
      )
    ).rows;
    // No cartão, o candidato a baixa do plano é o lançamento da competência
    // do mês (fatura que vence nele), não o da data da compra. Reutiliza os
    // eventos de cartão já lidos no início de readRoutine.
    for (const e of cardEvents)
      if (e.budget.month === month && !candidates.some((c) => c.id === e.id))
        candidates.push(e);
    const receipts = (
      await tx.query<{
        label: string;
        expected_date: string;
        received_date: string | null;
        budget_month: string;
        state: string;
        note: string;
        amount_cents: string | null;
      }>(
        `SELECT r.label,o.expected_date::text,b.transaction_date::text AS received_date,i.month::text AS budget_month,o.match_state AS state,o.match_note AS note,b.amount_cents::text FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id LEFT JOIN bank_transactions b ON b.id=o.match_bank_transaction_id WHERE o.household_id=$1 AND date_trunc('month',o.occurrence_date)=$2::date AND r.purpose='income' AND NOT r.paused AND NOT i.archived AND i.month<>date_trunc('month',o.occurrence_date)::date`,
        [user.familyId, month + "-01"],
      )
    ).rows;
    const seriesContexts = await loadSeriesContexts(
      tx,
      user.familyId,
      items.map((i) => i.id),
    );
    const seriesSuggestions = await suggestForSeriesItems(
      tx,
      user.familyId,
      month,
      items.filter((i) => seriesContexts.has(i.id)),
      seriesContexts,
    );
    const bankCover = await readBankCover(tx, user.familyId, [month]);
    // Apelido só para exibição: description segue intacta nos candidatos.
    const nicks = new Map(
      (
        await tx.query<{ id: string; display_name: string | null; alias_name: string | null }>(
          `SELECT e.id,e.display_name,ma.alias AS alias_name FROM economic_events e LEFT JOIN merchant_aliases ma ON ma.household_id=e.household_id AND ma.key=merchant_key(e.description) WHERE e.household_id=$1 AND e.id=ANY($2::uuid[])`,
          [
            user.familyId,
            [
              ...candidates.map((c) => c.id),
              ...[...seriesSuggestions.values()].flat().map((c) => c.id),
            ],
          ],
        )
      ).rows.map((r) => [r.id, r] as const),
    );
    const named = <T extends { id: string; description: string }>(list: T[]) =>
      list.map((e) => ({
        ...e,
        name: eventName({
          display_name: nicks.get(e.id)?.display_name,
          alias_name: nicks.get(e.id)?.alias_name,
          description: e.description,
        }),
      }));
    return {
      receipts,
      items: items.map((item) => ({
        ...item,
        recurrence: itemRecurrence(seriesContexts.get(item.id)),
        funding: funding.find((f) => f.monthly_item_id === item.id),
        bank_cover: coverView(bankCover.get(item.id)),
        candidates: named(seriesSuggestions.get(item.id) ??
          candidates
          .filter(
            (e) =>
              e.currency === item.currency &&
              (item.purpose === "income"
                ? ["income", "yield"].includes(e.kind)
                : item.purpose === "card"
                  ? e.kind === "card_payment"
                  : ["expense", "fee", "card_purchase"].includes(e.kind)) &&
              item.planned_cents !== null &&
              (BigInt(e.amount_cents) < 0n
                ? -BigInt(e.amount_cents)
                : BigInt(e.amount_cents)) === BigInt(item.planned_cents),
          )
          .slice(0, 6)),
      })),
    };
  });
}
export async function saveItem(db: Database, user: Identity, raw: unknown) {
  return asUser(db, user.userId, (tx) => saveItemTx(tx, user, raw));
}
export async function saveItemTx(
  tx: Transaction,
  user: Identity,
  raw: unknown,
) {
  const input = itemSchema.parse(raw),
    month = dateOnly(input.month + "-01");
  const amount = input.amount.trim() ? cents(input.amount).toString() : null;
  if (amount !== null && BigInt(amount) < 0n)
    throw new UserError("Informe um valor positivo.");
  const due = input.due_date ? dateOnly(input.due_date) : null;
  if (due && !due.startsWith(input.month + "-"))
    throw new UserError("O vencimento precisa ser deste mês.");
  const id = input.id ?? randomUUID();
  if (input.id) {
    const result = await tx.query(
      `UPDATE monthly_items SET label=$1,planned_cents=$2,due_date=$3,notes=$4,category_id=$5,cost_type=CASE WHEN $12::boolean THEN $13::text ELSE cost_type END,derived=false,version=version+1,updated_at=now() WHERE id=$6 AND household_id=$7 AND version=$8 AND month=$9 AND currency=$10 AND purpose=$11 AND NOT archived RETURNING id`,
      [
        input.label,
        amount,
        due,
        input.notes,
        input.category_id,
        id,
        user.familyId,
        input.version,
        month,
        input.currency,
        input.purpose,
        input.cost_type !== undefined,
        input.cost_type ?? null,
      ],
    );
    if (!result.rows.length)
      throw new UserError(
        "O item mudou no outro aparelho. Atualize antes de salvar.",
      );
  } else
    await tx.query(
      `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,due_date,category_id,notes,created_by,cost_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        user.familyId,
        month,
        input.label,
        input.purpose,
        input.currency,
        amount,
        due,
        input.category_id,
        input.notes,
        user.userId,
        input.cost_type ?? null,
      ],
    );
  await recordAudit(tx, user.familyId, user.userId, "routine.save", id);
  return { id };
}
export async function checkItem(db: Database, user: Identity, raw: unknown) {
  return asUser(db, user.userId, (tx) => checkItemTx(tx, user, raw));
}
export async function checkItemTx(
  tx: Transaction,
  user: Identity,
  raw: unknown,
) {
  const input = z
    .object({
      id: z.uuid(),
      version: z.number().int().positive(),
      status: z.enum(["open", "done", "partial"]),
      amount: z.string().nullable().default(null),
      date: z.string().nullable().default(null),
      event_id: z.uuid().nullable().default(null),
      allow_other_account: z.boolean().optional(),
    })
    .strict()
    .parse(raw);
  const date = input.date ? dateOnly(input.date) : null;
  const amount = input.amount ? cents(input.amount) : null;
  if (amount !== null && amount < 0n)
    throw new UserError("Informe um valor positivo.");
  const item = (
    await tx.query<MonthlyItem>(
      "SELECT *,planned_cents::text FROM monthly_items WHERE household_id=$1 AND id=$2 AND NOT archived FOR UPDATE",
      [user.familyId, input.id],
    )
  ).rows[0];
  if (!item || item.version !== input.version)
    throw new UserError("O item mudou no outro aparelho. Atualize sua lista.");
  let otherAccountAllowed = false;
  if (input.event_id) {
    const event = (
      await tx.query<{ currency: string; kind: string; account_id: string }>(
        "SELECT currency,kind,account_id FROM economic_events WHERE household_id=$1 AND id=$2",
        [user.familyId, input.event_id],
      )
    ).rows[0];
    const series =
      (await loadSeriesContexts(tx, user.familyId, [item.id])).get(item.id) ??
      null;
    const allowed = allowedEventKinds(item.purpose, series);
    if (
      !event ||
      event.currency !== item.currency ||
      !allowed.includes(event.kind)
    )
      throw new UserError("Esse movimento não corresponde ao compromisso.");
    if (series?.account_id && event.account_id !== series.account_id) {
      if (input.allow_other_account !== true)
        throw new UserError(
          "Esse movimento é de outra conta, diferente da prevista nesta conta fixa. Confirme se quer conciliar mesmo assim.",
        );
      otherAccountAllowed = true;
    }
    const duplicate = await tx.query(
      "SELECT id FROM monthly_items WHERE household_id=$1 AND event_id=$2 AND id<>$3 AND NOT archived",
      [user.familyId, input.event_id, item.id],
    );
    if (duplicate.rows.length)
      throw new UserError(
        "Esse movimento já está vinculado a outra conta do mês.",
      );
  }
  // Checklist is a plan, never a second copy of the bank transaction.
  await tx.query(
    `UPDATE monthly_items SET status=$1,paid_cents=$2,paid_date=$3,event_id=$4,version=version+1,updated_at=now() WHERE id=$5`,
    [
      input.status,
      input.status === "open"
        ? null
        : (amount?.toString() ??
          (input.status === "done" ? item.planned_cents : null)),
      input.status === "open" ? null : date,
      input.status === "open" ? null : input.event_id,
      item.id,
    ],
  );
  await recordAudit(tx, user.familyId, user.userId, "routine.check", item.id, {
    status: input.status,
    no_new_financial_event: true,
    ...(otherAccountAllowed ? { allow_other_account: true } : {}),
  });
  return { ok: true };
}
export async function copyMonth(db: Database, user: Identity, raw: unknown) {
  const input = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}$/),
    })
    .strict()
    .parse(raw);
  dateOnly(input.from + "-01");
  dateOnly(input.to + "-01");
  if (input.from === input.to) throw new UserError("Selecione outro mês.");
  return asUser(db, user.userId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "bank-analysis:" + user.familyId,
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      user.familyId + input.to,
    ]);
    if (
      (
        await tx.query(
          `SELECT 1 FROM monthly_items m WHERE household_id=$1 AND month=$2 AND NOT archived AND NOT derived AND NOT EXISTS(SELECT 1 FROM recurrence_occurrences r JOIN recurrences s ON s.household_id=r.household_id AND s.id=r.recurrence_id WHERE r.household_id=m.household_id AND r.monthly_item_id=m.id AND s.purpose<>'income') AND NOT (purpose='income' AND status='open' AND event_id IS NULL AND EXISTS(SELECT 1 FROM recurrence_occurrences o JOIN recurrences s ON s.household_id=o.household_id AND s.id=o.recurrence_id WHERE o.household_id=m.household_id AND o.monthly_item_id=m.id AND s.purpose='income')) LIMIT 1`,
          [user.familyId, input.to + "-01"],
        )
      ).rows.length
    )
      throw new UserError(
        "Este mês já tem planejamento. Nada foi sobrescrito.",
      );
    const items = (
      await tx.query<MonthlyItem>(
        "SELECT *,due_date::text,planned_cents::text FROM monthly_items m WHERE household_id=$1 AND month=$2 AND NOT archived AND NOT EXISTS(SELECT 1 FROM recurrence_occurrences o JOIN recurrences s ON s.household_id=o.household_id AND s.id=o.recurrence_id WHERE o.household_id=m.household_id AND o.monthly_item_id=m.id AND s.purpose<>'income')",
        [user.familyId, input.from + "-01"],
      )
    ).rows;
    if (!items.length) throw new UserError("O mês de origem não tem itens.");
    const last = new Date(
      Number(input.to.slice(0, 4)),
      Number(input.to.slice(5, 7)),
      0,
    ).getDate();
    for (const i of items) {
      const forecast = (
        await tx.query(
          `SELECT 1 FROM monthly_items m JOIN recurrence_occurrences o ON o.monthly_item_id=m.id AND o.household_id=m.household_id JOIN recurrences s ON s.household_id=o.household_id AND s.id=o.recurrence_id AND s.purpose='income' WHERE m.household_id=$1 AND m.month=$2 AND upper(m.label)=upper($3) AND m.purpose=$4 AND NOT m.archived`,
          [user.familyId, input.to + "-01", i.label, i.purpose],
        )
      ).rows.length;
      if (forecast) continue;
      const due = i.due_date
        ? input.to +
          "-" +
          String(Math.min(Number(i.due_date.slice(8, 10)), last)).padStart(
            2,
            "0",
          )
        : null;
      await tx.query(
        `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,category_id,due_date,notes,created_by,cost_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          user.familyId,
          input.to + "-01",
          i.label,
          i.purpose,
          i.currency,
          i.planned_cents,
          i.category_id,
          due,
          i.notes,
          user.userId,
          i.cost_type ?? null,
        ],
      );
    }
    await recordAudit(
      tx,
      user.familyId,
      user.userId,
      "routine.copy",
      user.familyId,
      { from: input.from, to: input.to, items: items.length },
    );
    return { copied: items.length };
  });
}
