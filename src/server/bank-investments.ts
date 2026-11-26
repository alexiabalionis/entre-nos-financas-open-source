import { z } from "zod";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { credentials, realReader, type Factory } from "./banks.ts";

// Investimentos da conexão (caixinhas do Nubank, CDB, fundos) direto da
// Pluggy. Só leitura: nada é gravado; serve para conferir o que o banco
// devolve antes de decidir como guardar saldo e movimentos.

export async function readBankInvestments(
  db: Database,
  u: Identity,
  raw: unknown,
  factory: Factory = realReader,
) {
  const input = z.object({ id: z.uuid() }).strict().parse(raw);
  const connection = (
    await asUser(db, u.userId, (tx) =>
      tx.query<{ item_id: string }>(
        "SELECT item_id FROM bank_connections WHERE id=$1 AND household_id=$2 AND user_id=$3 AND enabled",
        [input.id, u.familyId, u.userId],
      ),
    )
  ).rows[0];
  if (!connection) throw new UserError("Conexão indisponível para esse acesso.");
  const reader = factory(await credentials(db, u));
  await reader.authenticate();
  const item = await reader.item(connection.item_id);
  const investments = await reader.investments(connection.item_id);
  const result = [];
  for (const i of investments) {
    const moves = await reader.investmentTransactions(i.id);
    result.push({
      id: i.id,
      name: i.name,
      type: i.type ?? null,
      subtype: i.subtype ?? null,
      status: i.status ?? null,
      currency: i.currencyCode ?? null,
      balance: i.balance ?? null,
      amount: i.amount ?? null,
      date: i.date ?? null,
      moves: moves.map((m) => ({
        id: m.id,
        type: m.type ?? null,
        movement: m.movementType ?? null,
        description: m.description ?? null,
        amount: m.amount ?? m.value ?? null,
        date: (m.date ?? m.tradeDate ?? "").slice(0, 10),
      })),
    });
  }
  return {
    connector: item.connector?.name ?? null,
    products: item.products ?? null,
    investments_status: item.statusDetail?.investments ?? null,
    investments: result,
  };
}
