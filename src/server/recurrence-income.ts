import type { Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type { GeneratedItem, RecurrenceRow } from "./recurrence-sync.ts";

// Política de geração das entradas (6.1 item 5): ao CRIAR uma ocorrência que falta, o item do
// mês de planejamento é reaproveitado quando é o único de entrada com o mesmo nome; com mais de
// um, a data é pulada (continua lacuna). Ocorrência existente nunca passa por aqui (D2).
// Devolve o id do item a ligar, ou null para pular a data.
export async function createIncomeItem(
  tx: Transaction,
  userId: string,
  r: RecurrenceRow,
  item: GeneratedItem,
): Promise<string | null> {
  const plans = (
    await tx.query<{ id: string; linked: boolean }>(
      `SELECT m.id, EXISTS(SELECT 1 FROM recurrence_occurrences o WHERE o.household_id=m.household_id AND o.monthly_item_id=m.id) AS linked
         FROM monthly_items m
        WHERE m.household_id=$1 AND m.month=$2 AND m.purpose='income' AND NOT m.archived AND upper(m.label)=upper($3)
        ORDER BY m.id FOR UPDATE OF m`,
      [r.household_id, item.month, r.label],
    )
  ).rows;
  if (plans.length > 1) return null;
  if (plans[0]) return plans[0].linked ? null : plans[0].id;
  const itemId = randomUUID();
  const window = r.date_rule === "fifth_business_day";
  await tx.query(
    `INSERT INTO monthly_items(id,household_id,month,label,purpose,currency,planned_cents,notes,source_note,created_by) VALUES($1,$2,$3,$4,'income','BRL',$5,$6,$7,$8)`,
    [
      itemId,
      r.household_id,
      item.month,
      r.label,
      r.expected_cents,
      r.planning_offset === 1
        ? "Previsão: recebimento no mês anterior. Não representa receita confirmada."
        : "Previsão variável no mesmo mês. Não representa receita confirmada.",
      window
        ? "Janela esperada: cinco primeiros dias úteis, sem data ou valor garantidos; feriados podem alterar a estimativa. Financia o mesmo mês."
        : "Regra familiar: dia " +
          Number(r.start_date.slice(8, 10)) +
          ", antecipado para sexta no fim de semana; financia o mês seguinte.",
      userId,
    ],
  );
  return itemId;
}
