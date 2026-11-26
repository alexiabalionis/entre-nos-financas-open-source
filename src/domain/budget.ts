// Teto por categoria e comprometimento do mês. Funções puras: o realizado
// (`spending` do state.ts) chega pronto, nada aqui recalcula gasto.

export type CeilingRow = { month: string; planned_cents: string | null };

export type CommitmentItem = {
  purpose: string;
  planned_cents: string | null;
  paid_cents: string | null;
  archived: boolean;
  derived: boolean;
  event_id: string | null;
  /** Ausente nos testes antigos; só "partial" muda a regra do vínculo com evento. */
  status?: string;
  /** Conta fixa já paga pelo banco (fatura ou Pix): o gasto conta pela linha do banco. */
  bank_cover?: object | null;
};

export type Commitment = {
  ceiling_cents: bigint | null;
  realized_cents: bigint;
  open_planned_cents: bigint;
  committed_cents: bigint;
  remaining_cents: bigint | null;
  over: boolean;
};

// Linha mais recente com mês <= consultado (YYYY-MM-DD ordena como texto).
// Linha com planned null = "sem teto a partir daquele mês".
export function pickCeiling(
  rows: readonly CeilingRow[],
  month: string,
): { ceiling_cents: bigint | null; from: string | null } {
  let best: CeilingRow | null = null;
  for (const r of rows)
    if (r.month <= month && (!best || r.month > best.month)) best = r;
  if (!best || best.planned_cents === null)
    return { ceiling_cents: null, from: null };
  return { ceiling_cents: BigInt(best.planned_cents), from: best.month };
}

// Previsto em aberto: só despesa/benefício vivos e não derivados. Item ligado a
// uma transação conta só pela transação (já no realizado), exceto o parcial:
// o evento cobre o que foi pago, e o restante (planejado - pago) continua devido.
export function openPlannedCents(items: readonly CommitmentItem[]): bigint {
  let total = 0n;
  for (const i of items) {
    if (i.purpose !== "expense" && i.purpose !== "benefit") continue;
    if (i.archived || i.derived) continue;
    if (i.event_id !== null && i.status !== "partial") continue;
    if (i.bank_cover) continue;
    const left = BigInt(i.planned_cents ?? "0") - BigInt(i.paid_cents ?? "0");
    if (left > 0n) total += left;
  }
  return total;
}

export function commitment(input: {
  ceiling_cents: bigint | null;
  realized_cents: bigint;
  items: readonly CommitmentItem[];
  /** Saída agendada no banco que ainda não saiu: conta como "a pagar". */
  scheduled_cents?: bigint;
}): Commitment {
  const open = openPlannedCents(input.items) + (input.scheduled_cents ?? 0n);
  const committed = input.realized_cents + open;
  return {
    ceiling_cents: input.ceiling_cents,
    realized_cents: input.realized_cents,
    open_planned_cents: open,
    committed_cents: committed,
    remaining_cents:
      input.ceiling_cents === null ? null : input.ceiling_cents - committed,
    over: input.ceiling_cents !== null && committed > input.ceiling_cents,
  };
}

// Chave do realizado sem categoria no Map `spending` do state.ts.
export const UNCATEGORIZED = "uncategorized";

export type OutflowRow = {
  /** null = "Sem categoria". */
  category_id: string | null;
  realized_cents: bigint;
  open_planned_cents: bigint;
  committed_cents: bigint;
};

// Comprometido do mês por categoria (realizado + previsto em aberto), com ou
// sem teto: a mesma conta de `commitment`, para todas as categorias com saída.
// Itens e realizado sem categoria caem juntos em "Sem categoria" (null).
// `scheduled`: saída agendada no banco, já somada em `spending`, que ainda não
// saiu da conta; passa do realizado para o "a pagar" (o comprometido não muda).
export function categoryOutflow(
  spending: ReadonlyMap<string, bigint>,
  items: readonly (CommitmentItem & { category_id: string | null })[],
  scheduled: ReadonlyMap<string, bigint> = new Map(),
): OutflowRow[] {
  const key = (id: string | null) => id ?? UNCATEGORIZED;
  const byKey = new Map<string, CommitmentItem[]>();
  for (const i of items)
    byKey.set(key(i.category_id), [...(byKey.get(key(i.category_id)) ?? []), i]);
  const keys = new Set([...spending.keys(), ...byKey.keys()]);
  const rows: OutflowRow[] = [];
  for (const k of keys) {
    const later = scheduled.get(k) ?? 0n;
    const realized = (spending.get(k) ?? 0n) - later;
    const open = openPlannedCents(byKey.get(k) ?? []) + later;
    const committed = realized + open;
    // Só some a categoria sem movimento; líquido negativo (estorno) continua na lista.
    if (realized === 0n && open === 0n) continue;
    rows.push({
      category_id: k === UNCATEGORIZED ? null : k,
      realized_cents: realized,
      open_planned_cents: open,
      committed_cents: committed,
    });
  }
  return rows;
}
