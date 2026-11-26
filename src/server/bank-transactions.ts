// Listagem somente leitura de TODAS as transações lidas do banco conectado
// (tabela bank_transactions), qualquer status. Diferente de readBanks, que só
// devolve o que pede conferência (pending/changed/missing).
import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { credentials, realReader, type Factory } from "./banks.ts";
import { dateOnly } from "../domain/finance.ts";

const PAGE_SIZE = 100;
const filtersSchema = z.object({
  offset: z.number().int().min(0).max(100000).default(0),
  account: z.uuid().nullable().default(null),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable()
    .default(null),
  status: z
    .enum(["pending", "linked", "recorded", "ignored"])
    .nullable()
    .default(null),
});

export type BankTransactionsFilters = z.input<typeof filtersSchema>;

export async function listBankTransactions(
  db: Database,
  u: Identity,
  raw: BankTransactionsFilters = {},
) {
  const parsed = filtersSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Filtro inválido.");
  const f = parsed.data;
  return asUser(db, u.userId, async (tx) => {
    const where = `b.household_id=$1
      AND ($2::uuid IS NULL OR b.local_account_id=$2)
      AND ($3::text IS NULL OR b.status=$3)
      AND ($4::text IS NULL OR (b.transaction_date>=($4||'-01')::date
        AND b.transaction_date<(($4||'-01')::date+interval '1 month')))`;
    const params = [u.familyId, f.account, f.status, f.month];
    const rows = (
      await tx.query(
        `SELECT b.id,b.bank_account_id,b.local_account_id,a.name AS account_name,
           b.remote_id,b.transaction_date::text,b.description,b.amount_cents::text,
           b.currency,b.provider_status,b.operation_type,b.status,b.event_id,
           b.changed,b.missing,b.analysis->>'group' AS "group"
         FROM bank_transactions b JOIN accounts a ON a.id=b.local_account_id
         WHERE ${where}
         ORDER BY b.transaction_date DESC,b.id
         LIMIT ${PAGE_SIZE + 1} OFFSET $5`,
        [...params, f.offset],
      )
    ).rows;
    const total = (
      await tx.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM bank_transactions b WHERE ${where}`,
        params,
      )
    ).rows[0].count;
    return {
      transactions: rows.slice(0, PAGE_SIZE),
      total,
      hasMore: rows.length > PAGE_SIZE,
      offset: f.offset,
    };
  });
}

// Consulta AO VIVO no Pluggy (somente leitura, nada é gravado) das transações
// de uma conta conectada do próprio usuário, para comparar com o que está no
// banco local. `account` é o id de bank_accounts.
export async function compareRemoteTransactions(
  db: Database,
  u: Identity,
  raw: { account: string; from: string | null },
  factory: Factory = realReader,
) {
  const account = z.uuid().safeParse(raw.account);
  if (!account.success) throw new UserError("Informe a conta (account).");
  if (raw.from) dateOnly(raw.from);
  const target = await asUser(db, u.userId, async (tx) => {
    const row = (
      await tx.query<{
        remote_id: string;
        item_id: string;
        start_date: string;
      }>(
        `SELECT ba.remote_id,c.item_id,c.start_date::text
         FROM bank_accounts ba JOIN bank_connections c ON c.id=ba.connection_id
         WHERE ba.id=$1 AND ba.household_id=$2 AND c.user_id=$3`,
        [account.data, u.familyId, u.userId],
      )
    ).rows[0];
    if (!row) throw new UserError("Conta não encontrada na sua conexão.");
    return row;
  });
  const from = raw.from ?? target.start_date;
  const reader = factory(await credentials(db, u));
  await reader.authenticate();
  const item = await reader.item(target.item_id);
  const remote = (await reader.accounts(item.id)).find(
    (a) => a.id === target.remote_id,
  );
  if (!remote) throw new UserError("O banco não retornou essa conta.");
  const rows = await reader.transactions(remote, from);
  const local = await asUser(
    db,
    u.userId,
    async (tx) =>
      (
        await tx.query<{ remote_id: string; status: string }>(
          `SELECT remote_id,status FROM bank_transactions
         WHERE bank_account_id=$1 AND household_id=$2 AND transaction_date>=$3::date`,
          [account.data, u.familyId, from],
        )
      ).rows,
  );
  const localById = new Map(local.map((l) => [l.remote_id, l.status]));
  const remoteIds = new Set(rows.map((r) => r.remote_id));
  return {
    item_status: item.status,
    from,
    remote_count: rows.length,
    local_count: local.length,
    transactions: rows.map((r) => ({
      ...r,
      local_status: localById.get(r.remote_id) ?? null,
    })),
    only_in_pluggy: rows.filter((r) => !localById.has(r.remote_id)).length,
    only_in_local: local
      .filter((l) => !remoteIds.has(l.remote_id))
      .map((l) => l.remote_id),
  };
}
