import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type { Identity } from "./auth.ts";
import { asUser, recordAudit, type Database } from "./db.ts";
import { createManualEventTx } from "./manual.ts";
import { resolveCategory } from "./assisted.ts";
import { plainMoney } from "../domain/format.ts";
import { billPayment } from "../domain/bank-analysis.ts";
import { normalize } from "../domain/finance.ts";
import { createPairs, createRefunds, inSavepoint, linkAuto } from "./bank-pair-events.ts";

// Fases 2 e 3 de docs/SPEC-FATOS-CARTAO.md. Compra de cartão é fato desde a
// leitura, postada ou não: vira evento card_purchase na sincronização, com a
// categoria de resolveCategory. Estorno, pagamento de fatura e transferência
// própria seguem em bank-pair-events.ts. O evento acompanha o banco (valor,
// data, descrição) e é cancelado, não apagado, quando a compra some.

const AMBIGUOUS = ["duplicate", "history", "statement", "card", "transfer", "investment"];
export const GONE_REASON = "Sumiu do banco.";

type Row = {
  id: string;
  local_account_id: string;
  transaction_date: string;
  description: string;
  amount_cents: string;
  operation_type: string;
  group: string | null;
};

export type BankEventSync = {
  created: number;
  refunds: number;
  pairs: number;
  updated: number;
  cancelled: number;
  restored: number;
};

/**
 * Carga do passado (fase 5): roda as mesmas regras da leitura sobre o que já
 * está guardado, sem chamar o banco. Usa a mesma trava da leitura para não
 * cruzar com uma sincronização em andamento. Idempotente: na segunda vez não
 * encontra nada. Só registra auditoria quando mudou algo.
 */
export async function backfillBankEvents(db: Database, u: Identity): Promise<BankEventSync> {
  return asUser(db, u.userId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["bank-analysis:" + u.familyId]);
    const result = await syncBankEvents(tx, u);
    if (Object.values(result).some((n) => n > 0))
      await recordAudit(tx, u.familyId, u.userId, "bank.events_backfill", u.familyId, result);
    return result;
  });
}

// Ordem: compras antes dos estornos (o estorno procura a compra de origem já
// como evento), depois os pares; por último acompanhar e cancelar.
export async function syncBankEvents(tx: Transaction, u: Identity): Promise<BankEventSync> {
  const created = await createMissing(tx, u);
  const refunds = await createRefunds(tx, u);
  const pairs = await createPairs(tx, u);
  const updated = await followBank(tx, u.familyId);
  const gone = await cancelGone(tx, u.familyId);
  return { created, refunds, pairs, updated, ...gone };
}

async function createMissing(tx: Transaction, u: Identity): Promise<number> {
  const rows = (
    await tx.query<Row>(
      `SELECT b.id,b.local_account_id,b.transaction_date::text,b.description,b.amount_cents::text,b.operation_type,b.analysis->>'group' AS "group"
       FROM bank_transactions b
       JOIN bank_accounts ba ON ba.id=b.bank_account_id
       JOIN accounts a ON a.id=b.local_account_id
       WHERE b.household_id=$1 AND ba.account_type='CREDIT' AND a.kind='card'
         AND b.status='pending' AND b.event_id IS NULL AND NOT b.changed AND NOT b.missing
         AND b.currency='BRL' AND b.amount_cents<0
       ORDER BY b.transaction_date,b.id`,
      [u.familyId],
    )
  ).rows.filter(
    (r) =>
      !AMBIGUOUS.includes(r.group ?? "") &&
      !billPayment(normalize(r.description), normalize(r.operation_type)),
  );
  if (!rows.length) return 0;
  const rules = (
    await tx.query<{ match_text: string; category_name: string }>(
      "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
      [u.familyId],
    )
  ).rows;
  let created = 0;
  for (const row of rows) {
    // Uma linha que a validação do evento recusa (ex.: anterior à abertura da
    // conta) fica pendente, sem abortar a leitura inteira.
    const ok = await inSavepoint(tx, async () => {
      const category = await categoryId(tx, u.familyId, resolveCategory(rules, row.description).name);
      const event = await createManualEventTx(tx, u, {
        account_id: row.local_account_id,
        date: row.transaction_date,
        description: row.description,
        amount: plainMoney(row.amount_cents),
        kind: "card_purchase",
        category_id: category,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
        request_id: row.id,
      });
      await tx.query(
        "UPDATE economic_events e SET tag_id=t.id FROM bank_transactions b JOIN category_tags t ON t.id=b.tag_id AND t.household_id=b.household_id WHERE b.id=$1 AND e.id=$2 AND e.household_id=$3 AND e.category_id=t.category_id",
        [row.id, event, u.familyId],
      );
      await linkAuto(tx, event, [row.id]);
    });
    if (ok) created++;
  }
  return created;
}

export async function categoryId(tx: Transaction, family: string, name: string) {
  await tx.query(
    "INSERT INTO categories(id,household_id,name,essential) VALUES($1,$2,$3,false) ON CONFLICT(household_id,name) DO NOTHING",
    [randomUUID(), family, name],
  );
  return (
    await tx.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [family, name])
  ).rows[0].id;
}

// A linha automática segue o banco em storeObservations; aqui o evento acompanha
// valor, data e descrição da ponta de origem (a linha da conta do evento). As
// pernas do lançamento mudam juntas (o gatilho de equilíbrio é adiado para o fim
// da transação). Se o banco inverter o sinal ou desfizer o par, o evento é
// cancelado com o motivo, sem apagar.
const SIGN: Record<string, 1 | -1> = {
  card_purchase: -1,
  refund: 1,
  card_payment: -1,
  transfer: -1,
  expense: -1,
  fee: -1,
  income: 1,
  yield: 1,
};
export const CHANGED_REASON = "O banco mudou este movimento e ele precisa de revisão.";

async function followBank(tx: Transaction, family: string): Promise<number> {
  const stale = (
    await tx.query<{
      event_id: string;
      account_id: string;
      kind: string;
      amount_cents: string;
      transaction_date: string;
      description: string;
      legs_sum: string;
      legs: number;
    }>(
      `SELECT e.id AS event_id,e.account_id,e.kind,s.amount_cents::text,s.transaction_date::text,s.description,
        (SELECT sum(o.amount_cents) FROM bank_transactions o WHERE o.event_id=e.id AND o.household_id=e.household_id)::text AS legs_sum,
        (SELECT count(*) FROM bank_transactions o WHERE o.event_id=e.id AND o.household_id=e.household_id)::int AS legs
       FROM economic_events e
       JOIN bank_transactions s ON s.event_id=e.id AND s.household_id=e.household_id AND s.local_account_id=e.account_id
       WHERE e.household_id=$1 AND s.auto_recorded AND e.cancelled_at IS NULL
         AND e.kind IN ('card_purchase','refund','card_payment','transfer','expense','fee','income','yield')
         AND (e.amount_cents<>s.amount_cents OR e.transaction_date<>s.transaction_date OR e.description<>s.description
           OR (SELECT sum(o.amount_cents) FROM bank_transactions o WHERE o.event_id=e.id AND o.household_id=e.household_id)<>CASE WHEN e.kind IN ('card_payment','transfer') THEN 0 ELSE s.amount_cents END)`,
      [family],
    )
  ).rows;
  for (const s of stale) {
    const amount = BigInt(s.amount_cents);
    const paired = s.kind === "card_payment" || s.kind === "transfer";
    const broken =
      Math.sign(Number(amount)) !== SIGN[s.kind] || (paired && (s.legs !== 2 || BigInt(s.legs_sum) !== 0n));
    if (broken) {
      await tx.query(
        "UPDATE economic_events SET cancelled_at=now(),cancel_reason=$1 WHERE id=$2 AND household_id=$3",
        [CHANGED_REASON, s.event_id, family],
      );
      continue;
    }
    await tx.query(
      "UPDATE economic_events SET amount_cents=$1,transaction_date=$2,description=$3,original_description=$3 WHERE id=$4 AND household_id=$5",
      [s.amount_cents, s.transaction_date, s.description, s.event_id, family],
    );
    await tx.query(
      "UPDATE ledger_entries SET amount_cents=CASE WHEN account_id=$1 THEN $2::bigint ELSE -$2::bigint END,transaction_date=$3 WHERE event_id=$4 AND household_id=$5",
      [s.account_id, s.amount_cents, s.transaction_date, s.event_id, family],
    );
  }
  return stale.length;
}

// Compra que sumiu do banco: o evento fica cancelado e visível. Se voltar, o
// cancelamento automático é desfeito; um cancelamento feito pela pessoa (outro
// motivo) não é tocado.
async function cancelGone(tx: Transaction, family: string) {
  const cancelled = await tx.query(
    `UPDATE economic_events e SET cancelled_at=now(),cancel_reason=$2
     FROM bank_transactions b
     WHERE b.event_id=e.id AND b.household_id=e.household_id AND b.household_id=$1
       AND b.auto_recorded AND b.missing AND e.cancelled_at IS NULL`,
    [family, GONE_REASON],
  );
  const restored = await tx.query(
    `UPDATE economic_events e SET cancelled_at=NULL,cancel_reason=NULL
     FROM bank_transactions b
     WHERE b.event_id=e.id AND b.household_id=e.household_id AND b.household_id=$1
       AND b.auto_recorded AND NOT b.missing AND e.cancel_reason=$2`,
    [family, GONE_REASON],
  );
  return { cancelled: cancelled.affectedRows ?? 0, restored: restored.affectedRows ?? 0 };
}
