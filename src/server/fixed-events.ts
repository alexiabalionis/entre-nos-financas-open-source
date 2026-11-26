import type { Transaction } from "@electric-sql/pglite";

// Eventos conciliados (monthly_items.event_id) a itens não arquivados. Só
// leitura, por família; eventIds limita a consulta. seriesOnly restringe a
// itens que são ocorrência de uma série de despesa.
async function linkedEventIds(
  tx: Transaction,
  familyId: string,
  eventIds: readonly string[] | undefined,
  seriesOnly: boolean,
): Promise<Set<string>> {
  if (eventIds && eventIds.length === 0) return new Set();
  const series = seriesOnly
    ? `JOIN recurrence_occurrences o ON o.household_id=i.household_id AND o.monthly_item_id=i.id
       JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id AND r.purpose='expense'`
    : "";
  const rows = (
    await tx.query<{ event_id: string }>(
      `SELECT DISTINCT i.event_id::text AS event_id
       FROM monthly_items i ${series}
       WHERE i.household_id=$1 AND i.event_id IS NOT NULL AND NOT i.archived
         AND ($2::uuid[] IS NULL OR i.event_id=ANY($2::uuid[]))`,
      [familyId, eventIds ? [...eventIds] : null],
    )
  ).rows;
  return new Set(rows.map((r) => r.event_id));
}

// Única regra de "conta fixa" para transações (a de itens é isFixedBill, em
// domain/recurrence.ts): o evento está conciliado a um item que é ocorrência
// de uma série de despesa. Categoria, nome e valor nunca decidem.
export const fixedEventIds = (
  tx: Transaction,
  familyId: string,
  eventIds?: readonly string[],
) => linkedEventIds(tx, familyId, eventIds, true);

// Evento conciliado a QUALQUER item planejado (de série ou avulso).
export const reconciledEventIds = (
  tx: Transaction,
  familyId: string,
  eventIds?: readonly string[],
) => linkedEventIds(tx, familyId, eventIds, false);
