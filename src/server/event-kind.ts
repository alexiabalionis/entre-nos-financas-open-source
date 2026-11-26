import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { accountFor, UserError } from "./imports.ts";
import { createManualEventTx } from "./manual.ts";
import { resolveCategory } from "./assisted.ts";
import { requireWriter } from "./event-cancel.ts";
import { categoryId } from "./bank-card-events.ts";
import { postings, type Kind } from "../domain/finance.ts";
import { plainMoney } from "../domain/format.ts";

// Fase 4 de docs/SPEC-FATOS-CARTAO.md: a pessoa corrige o tipo que o app
// decidiu. As duas linhas do razão são reescritas no lugar (nada é apagado), e o
// saldo de cada conta não muda: a ponta da conta do evento fica igual e a outra
// ponta passa a ser a contrapartida certa. Desfazer um par nunca esconde a outra
// ponta: ela ganha o próprio evento ou volta a pendente.

const KINDS = ["expense", "fee", "income", "yield", "card_purchase", "refund", "transfer", "card_payment"] as const;
const PAIRED = new Set<Kind>(["transfer", "card_payment"]);
const WITH_CATEGORY = new Set<Kind>(["expense", "fee", "income", "yield", "card_purchase"]);

const schema = z
  .object({
    event_id: z.uuid(),
    kind: z.enum(KINDS),
    counter_account_id: z.uuid().nullable().default(null),
    counter_bank_transaction_id: z.uuid().nullable().default(null),
    related_event_id: z.uuid().nullable().default(null),
    category_name: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict();

type Event = {
  id: string;
  account_id: string;
  kind: Kind;
  amount_cents: string;
  currency: string;
  description: string;
  category_id: string | null;
  cancelled_at: string | null;
};

export async function changeEventKind(db: Database, user: Identity, raw: unknown) {
  requireWriter(user);
  const input = schema.parse(raw);
  return asUser(db, user.userId, async (tx) => {
    const event = (
      await tx.query<Event>(
        "SELECT id,account_id,kind,amount_cents::text,currency,description,category_id,cancelled_at::text FROM economic_events WHERE id=$1 AND household_id=$2 FOR UPDATE",
        [input.event_id, user.familyId],
      )
    ).rows[0];
    if (!event) throw new UserError("Movimento indisponível.");
    if (event.cancelled_at) throw new UserError("Restaure o movimento antes de mudar o tipo.");
    const legs = (
      await tx.query<{ id: string; account_id: string | null }>(
        "SELECT id,account_id FROM ledger_entries WHERE event_id=$1 AND household_id=$2",
        [event.id, user.familyId],
      )
    ).rows;
    const own = legs.find((l) => l.account_id === event.account_id);
    const other = legs.find((l) => l !== own);
    if (legs.length !== 2 || !own || !other)
      throw new UserError("Este movimento não pode mudar de tipo aqui.");
    const kind = input.kind as Kind;
    const paired = PAIRED.has(kind);
    if (paired && !input.counter_account_id) throw new UserError("Escolha a outra conta.");
    if (!paired && (input.counter_account_id || input.counter_bank_transaction_id))
      throw new UserError("Este tipo não tem outra conta.");
    if (kind !== "refund" && input.related_event_id) throw new UserError("Só estorno aponta para uma compra.");
    await guardRefunds(tx, user.familyId, event, kind);

    const account = await accountFor(tx, user.familyId, event.account_id);
    const counter = paired ? await accountFor(tx, user.familyId, input.counter_account_id!) : null;
    const amount = BigInt(event.amount_cents);
    let entries;
    try {
      entries = postings({
        kind,
        amount,
        accountId: account.id,
        currency: account.currency,
        accountKind: account.kind,
        counterId: counter?.id,
        counterKind: counter?.kind,
      });
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : "Tipo incompatível com o movimento.");
    }
    if (account.kind === "card" && !["card_purchase", "refund"].includes(kind))
      throw new UserError("No cartão, o movimento é compra ou estorno.");
    if (account.kind !== "card" && (kind === "card_purchase" || kind === "refund"))
      throw new UserError("Compra e estorno de cartão só existem na conta do cartão.");

    const related = kind === "refund" ? await refundOrigin(tx, user.familyId, event, input.related_event_id) : null;
    const category = paired
      ? null
      : related
        ? related.category_id
        : WITH_CATEGORY.has(kind)
          ? input.category_name
            ? await categoryId(tx, user.familyId, input.category_name)
            : (event.category_id ?? (await suggestedCategory(tx, user.familyId, event.description)))
          : null;

    // Ponta que deixa de ser contrapartida (par desfeito ou trocado de conta).
    await releaseOtherSide(tx, user, event, counter?.id ?? null);
    if (input.counter_bank_transaction_id)
      await attachOtherSide(tx, user.familyId, event, counter!.id, input.counter_bank_transaction_id);

    const second = entries.find((e) => !(e.accountId === account.id && e.nominal === null))!;
    await tx.query(
      "UPDATE economic_events SET kind=$1,counter_account_id=$2,category_id=$3,related_event_id=$4,tag_id=CASE WHEN category_id IS DISTINCT FROM $3 THEN NULL ELSE tag_id END WHERE id=$5 AND household_id=$6",
      [kind, counter?.id ?? null, category, related?.id ?? null, event.id, user.familyId],
    );
    await tx.query("UPDATE ledger_entries SET account_id=$1,nominal=$2,amount_cents=$3 WHERE id=$4", [
      second.accountId,
      second.nominal,
      second.cents.toString(),
      other.id,
    ]);
    await recordAudit(tx, user.familyId, user.userId, "event.kind", event.id, { from: event.kind, to: kind });
    return { event_id: event.id, kind };
  });
}

// Compra com estorno ligado precisa continuar sendo um gasto.
async function guardRefunds(tx: Transaction, family: string, event: Event, kind: Kind) {
  if (["expense", "card_purchase", "fee"].includes(kind)) return;
  const refunds = await tx.query(
    "SELECT 1 FROM economic_events WHERE household_id=$1 AND related_event_id=$2 AND kind='refund' AND cancelled_at IS NULL LIMIT 1",
    [family, event.id],
  );
  if (refunds.rows.length) throw new UserError("Há estorno ligado a esta compra. Ajuste o estorno antes.");
}

async function refundOrigin(tx: Transaction, family: string, event: Event, relatedId: string | null) {
  if (!relatedId) throw new UserError("Escolha a compra que foi estornada.");
  const original = (
    await tx.query<{ id: string; kind: string; currency: string; amount_cents: string; category_id: string | null; refunded: string }>(
      `SELECT e.id,e.kind,e.currency,e.amount_cents::text,e.category_id,
        coalesce((SELECT sum(r.amount_cents) FROM economic_events r WHERE r.related_event_id=e.id AND r.kind='refund' AND r.id<>$3 AND r.cancelled_at IS NULL),0)::text AS refunded
       FROM economic_events e WHERE e.household_id=$1 AND e.id=$2 AND e.cancelled_at IS NULL`,
      [family, relatedId, event.id],
    )
  ).rows[0];
  if (!original || original.id === event.id || !["expense", "card_purchase", "fee"].includes(original.kind) || original.currency !== event.currency)
    throw new UserError("Vincule o estorno a uma compra da mesma moeda.");
  if (BigInt(original.refunded) + BigInt(event.amount_cents) > -BigInt(original.amount_cents))
    throw new UserError("O estorno passa do valor da compra.");
  return original;
}

async function suggestedCategory(tx: Transaction, family: string, description: string) {
  const rules = (
    await tx.query<{ match_text: string; category_name: string }>(
      "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
      [family],
    )
  ).rows;
  return categoryId(tx, family, resolveCategory(rules, description).name);
}

// Linhas do banco presas a este evento em outra conta que não a nova
// contrapartida. Conta corrente ganha o próprio evento (entrada ou gasto); no
// cartão volta a pendente, onde os leitores já a tratam como antes.
async function releaseOtherSide(tx: Transaction, user: Identity, event: Event, keep: string | null) {
  const rows = (
    await tx.query<{ id: string; local_account_id: string; transaction_date: string; description: string; amount_cents: string; kind: string }>(
      `SELECT b.id,b.local_account_id,b.transaction_date::text,b.description,b.amount_cents::text,a.kind
       FROM bank_transactions b JOIN accounts a ON a.id=b.local_account_id
       WHERE b.event_id=$1 AND b.household_id=$2 AND b.local_account_id<>$3 AND b.local_account_id IS DISTINCT FROM $4`,
      [event.id, user.familyId, event.account_id, keep],
    )
  ).rows;
  for (const row of rows) {
    await tx.query(
      "UPDATE bank_transactions SET status='pending',event_id=NULL,auto_recorded=false,version=version+1 WHERE id=$1",
      [row.id],
    );
    if (row.kind === "card") continue;
    const own = await createManualEventTx(tx, user, {
      account_id: row.local_account_id,
      date: row.transaction_date,
      description: row.description,
      amount: plainMoney(row.amount_cents),
      kind: BigInt(row.amount_cents) < 0n ? "expense" : "income",
      category_id: await suggestedCategory(tx, user.familyId, row.description),
      counter_account_id: null,
      counter_currency: null,
      counter_amount: null,
      related_event_id: null,
    });
    await tx.query(
      "UPDATE bank_transactions SET status='recorded',event_id=$1,auto_recorded=true,version=version+1 WHERE id=$2",
      [own, row.id],
    );
  }
}

async function attachOtherSide(tx: Transaction, family: string, event: Event, counterId: string, rowId: string) {
  const row = (
    await tx.query<{ amount_cents: string }>(
      "SELECT amount_cents::text FROM bank_transactions WHERE id=$1 AND household_id=$2 AND local_account_id=$3 AND status='pending' AND event_id IS NULL AND NOT missing FOR UPDATE",
      [rowId, family, counterId],
    )
  ).rows[0];
  if (!row || BigInt(row.amount_cents) !== -BigInt(event.amount_cents))
    throw new UserError("A outra ponta precisa estar pendente, na outra conta e com o mesmo valor.");
  await tx.query(
    "UPDATE bank_transactions SET status='recorded',event_id=$1,auto_recorded=true,version=version+1 WHERE id=$2",
    [event.id, rowId],
  );
}
