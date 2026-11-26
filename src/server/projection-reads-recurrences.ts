import type { Transaction } from "@electric-sql/pglite";
import { economicEffect, type Kind } from "../domain/finance.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import type { Spend } from "../domain/projection-recurrences.ts";
import { merchantKey } from "./assisted.ts";

// Leituras do histórico de gasto e das recusas de sugestão. Servem só às
// sugestões de conta fixa (monthlyCandidates): a projeção do Copiloto não
// prevê mais nada pelo comportamento. Só leitura, por família.

export const pairKey = (scope: string, merchant: string) =>
  `${scope}\u0000${merchant}`;

// Decisões do usuário (confirmar/dispensar), na chave do motor scope|merchant.
export async function readRecurrenceDecisions(
  tx: Transaction,
  familyId: string,
): Promise<Map<string, "confirm" | "dismiss">> {
  const rows = (
    await tx.query<{
      scope: string;
      merchant_key: string;
      decision: "confirm" | "dismiss";
    }>(
      "SELECT scope,merchant_key,decision FROM recurrence_decisions WHERE household_id=$1",
      [familyId],
    )
  ).rows;
  return new Map(rows.map((r) => [pairKey(r.scope, r.merchant_key), r.decision]));
}

// Gasto real aprovado (BRL) dos 3 meses completos anteriores + o mês atual (o
// motor usa o mês atual só para não reprojetar o que já aconteceu). Só conta o
// que economicEffect trata como despesa: transferência, pagamento de fatura,
// estorno e entrada ficam de fora. merchant = merchantKey (a normalização do
// app); scope = id do cartão ou 'cash'.
export async function readSpendHistory(
  tx: Transaction,
  familyId: string,
  currentMonth: string,
): Promise<{
  spends: Spend[];
  categoryByPair: Map<string, string | null>;
}> {
  const from = shiftMonth(currentMonth, -3) + "-01";
  const to = shiftMonth(currentMonth, 1) + "-01";
  const rows = (
    await tx.query<{
      kind: Kind;
      amount_cents: string;
      description: string;
      transaction_date: string;
      account_id: string;
      is_card: boolean;
      category_id: string | null;
    }>(
      `SELECT e.kind,e.amount_cents::text,e.description,e.transaction_date::text,
        e.account_id,(a.kind='card') AS is_card,e.category_id
       FROM economic_events e
       JOIN accounts a ON a.household_id=e.household_id AND a.id=e.account_id
       WHERE e.household_id=$1 AND e.currency='BRL'
         AND e.kind IN ('expense','card_purchase','fee')
         AND e.counter_account_id IS NULL
         AND e.transaction_date>=$2::date AND e.transaction_date<$3::date
       ORDER BY e.transaction_date,e.id`,
      [familyId, from, to],
    )
  ).rows;
  const spends: Spend[] = [];
  const categoryByPair = new Map<string, string | null>();
  for (const r of rows) {
    const cents = economicEffect(r.kind, BigInt(r.amount_cents)).expense;
    const merchant = merchantKey(r.description);
    if (cents <= 0n || !merchant) continue;
    const scope = r.is_card ? r.account_id : "cash";
    spends.push({
      scope,
      merchant,
      month: r.transaction_date.slice(0, 7),
      day: Number(r.transaction_date.slice(8, 10)),
      cents,
    });
    const pk = pairKey(scope, merchant);
    if (r.category_id || !categoryByPair.has(pk))
      categoryByPair.set(pk, r.category_id ?? categoryByPair.get(pk) ?? null);
  }
  return { spends, categoryByPair };
}

// "NETFLIX COM" -> "Netflix Com": rótulo legível do lojista normalizado.
export { readable } from "../domain/format.ts";

