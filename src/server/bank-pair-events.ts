import type { Transaction } from "@electric-sql/pglite";
import type { Identity } from "./auth.ts";
import { createManualEventTx } from "./manual.ts";
import { merchantKey } from "./assisted.ts";
import { plainMoney } from "../domain/format.ts";
import { billPayment } from "../domain/bank-analysis.ts";
import { normalize } from "../domain/finance.ts";

// Fase 3 de docs/SPEC-FATOS-CARTAO.md. Estorno no cartão vira refund ligado à
// compra de origem; pagamento de fatura e transferência própria viram UM evento
// neutro com as duas pontas. O que o app não identifica com segurança fica
// pendente, e os leitores já o tratam como antes (estorno abate, par é neutro).

const NOT_REFUND = ["duplicate", "history", "statement", "card", "transfer", "investment"];
const REFUND_LOOKBACK_DAYS = 180;
const NOISE = new Set(["ESTORNO", "CREDITO", "REEMBOLSO", "DEVOLUCAO", "COMPRA", "PARCELA", "CANCELAMENTO"]);

const tokens = (s: string) =>
  new Set(
    normalize(merchantKey(s))
      .split(/\W+/)
      .filter((w) => w.length > 3 && !NOISE.has(w)),
  );
// Palavras do comerciante em comum (0 = outro comerciante).
const shared = (a: string, b: string) => {
  const ta = tokens(a);
  return [...tokens(b)].filter((w) => ta.has(w)).length;
};

// Uma linha que a validação do evento recusa (ex.: anterior à abertura da
// conta) fica pendente, sem abortar a leitura inteira.
export async function inSavepoint(tx: Transaction, work: () => Promise<void>): Promise<boolean> {
  await tx.query("SAVEPOINT bank_event");
  try {
    await work();
    await tx.query("RELEASE SAVEPOINT bank_event");
    return true;
  } catch {
    await tx.query("ROLLBACK TO SAVEPOINT bank_event");
    return false;
  }
}

export async function linkAuto(tx: Transaction, event: string, rows: string[]) {
  await tx.query(
    "UPDATE bank_transactions SET status='recorded',event_id=$1,auto_recorded=true,version=version+1 WHERE id=ANY($2::uuid[])",
    [event, rows],
  );
}

export async function createRefunds(tx: Transaction, u: Identity): Promise<number> {
  const rows = (
    await tx.query<{ id: string; local_account_id: string; transaction_date: string; description: string; amount_cents: string; operation_type: string; group: string | null }>(
      `SELECT b.id,b.local_account_id,b.transaction_date::text,b.description,b.amount_cents::text,b.operation_type,b.analysis->>'group' AS "group"
       FROM bank_transactions b JOIN accounts a ON a.id=b.local_account_id
       WHERE b.household_id=$1 AND a.kind='card' AND b.status='pending' AND b.event_id IS NULL
         AND NOT b.changed AND NOT b.missing AND b.currency='BRL' AND b.amount_cents>0
       ORDER BY b.transaction_date,b.id`,
      [u.familyId],
    )
  ).rows.filter(
    (r) => !NOT_REFUND.includes(r.group ?? "") && !billPayment(normalize(r.description), normalize(r.operation_type)),
  );
  let created = 0;
  for (const row of rows) {
    const original = await refundOrigin(tx, u.familyId, row);
    if (!original) continue;
    const ok = await inSavepoint(tx, async () => {
      const event = await createManualEventTx(tx, u, {
        account_id: row.local_account_id,
        date: row.transaction_date,
        description: row.description,
        amount: plainMoney(row.amount_cents),
        kind: "refund",
        category_id: null,
        counter_account_id: null,
        counter_currency: null,
        counter_amount: null,
        related_event_id: original,
        request_id: row.id,
      });
      await linkAuto(tx, event, [row.id]);
    });
    if (ok) created++;
  }
  return created;
}

// Compra de origem do estorno: mesmo cartão, até 180 dias antes, com saldo a
// estornar. Mesmo comerciante e mesmo valor vence; depois só o mesmo
// comerciante. Mais de uma candidata empatada: não escolhe, fica pendente.
async function refundOrigin(
  tx: Transaction,
  family: string,
  row: { local_account_id: string; transaction_date: string; description: string; amount_cents: string },
): Promise<string | null> {
  const candidates = (
    await tx.query<{ id: string; description: string; amount_cents: string; refundable: string }>(
      `SELECT e.id,e.description,e.amount_cents::text,
        (-e.amount_cents-coalesce((SELECT sum(r.amount_cents) FROM economic_events r WHERE r.related_event_id=e.id AND r.kind='refund' AND r.cancelled_at IS NULL),0))::text AS refundable
       FROM economic_events e
       WHERE e.household_id=$1 AND e.account_id=$2 AND e.kind='card_purchase' AND e.cancelled_at IS NULL
         AND e.transaction_date<=$3::date AND e.transaction_date>=$3::date-$4::int`,
      [family, row.local_account_id, row.transaction_date, REFUND_LOOKBACK_DAYS],
    )
  ).rows
    .map((c) => ({ ...c, score: shared(c.description, row.description) }))
    .filter((c) => c.score > 0 && BigInt(c.refundable) >= BigInt(row.amount_cents));
  const exact = candidates.filter((c) => -BigInt(c.amount_cents) === BigInt(row.amount_cents));
  const pool = exact.length ? exact : candidates;
  // Mais palavras do comerciante em comum vence ("LOJA ROUPAS CENTRO" antes de
  // "LOJA A"); empate no topo continua sem escolha.
  const best = Math.max(0, ...pool.map((c) => c.score));
  const pick = pool.filter((c) => c.score === best);
  return pick.length === 1 ? pick[0].id : null;
}

type PairRow = {
  id: string;
  local_account_id: string;
  kind: string;
  transaction_date: string;
  description: string;
  amount_cents: string;
  group: string;
  related: string[];
};

// Par que a análise já identificou como único e mútuo (uma contrapartida de
// sinal oposto em outra conta, que também só aponta de volta). Pagamento de
// fatura: card_payment saindo da conta que pagou para o cartão. Transferência
// própria: transfer da conta de onde saiu para a de destino.
export async function createPairs(tx: Transaction, u: Identity): Promise<number> {
  const rows = (
    await tx.query<PairRow>(
      `SELECT b.id,b.local_account_id,a.kind,b.transaction_date::text,b.description,b.amount_cents::text,
        b.analysis->>'group' AS "group",
        coalesce(ARRAY(SELECT jsonb_array_elements_text(b.analysis->'related_ids')),'{}') AS related
       FROM bank_transactions b JOIN accounts a ON a.id=b.local_account_id
       WHERE b.household_id=$1 AND b.status='pending' AND b.event_id IS NULL
         AND NOT b.changed AND NOT b.missing AND b.currency='BRL'
         AND b.analysis->>'group' IN ('card','transfer')`,
      [u.familyId],
    )
  ).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const done = new Set<string>();
  let created = 0;
  for (const r of rows) {
    if (done.has(r.id) || r.related.length !== 1) continue;
    const peer = byId.get(r.related[0]);
    if (!peer || done.has(peer.id) || peer.related.length !== 1 || peer.related[0] !== r.id) continue;
    if (BigInt(r.amount_cents) !== -BigInt(peer.amount_cents)) continue;
    const kinds = [r.kind, peer.kind];
    const cardSide = kinds.includes("card") ? (r.kind === "card" ? r : peer) : null;
    let source: PairRow, target: PairRow, kind: "card_payment" | "transfer";
    if (cardSide) {
      // Pagamento de fatura: só uma ponta é cartão, e ela recebe o crédito.
      if (kinds.every((k) => k === "card") || BigInt(cardSide.amount_cents) <= 0n) continue;
      target = cardSide;
      source = cardSide === r ? peer : r;
      kind = "card_payment";
    } else {
      if (r.group !== "transfer" || peer.group !== "transfer") continue;
      source = BigInt(r.amount_cents) < 0n ? r : peer;
      target = source === r ? peer : r;
      kind = "transfer";
    }
    const ok = await inSavepoint(tx, async () => {
      const event = await createManualEventTx(tx, u, {
        account_id: source.local_account_id,
        date: source.transaction_date,
        description: source.description,
        amount: plainMoney(source.amount_cents),
        kind,
        category_id: null,
        counter_account_id: target.local_account_id,
        counter_currency: null,
        counter_amount: null,
        related_event_id: null,
        request_id: source.id,
      });
      await linkAuto(tx, event, [source.id, target.id]);
    });
    done.add(r.id);
    done.add(peer.id);
    if (ok) created++;
  }
  return created;
}
