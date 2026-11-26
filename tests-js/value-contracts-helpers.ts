import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "../src/server/db.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { readState } from "../src/server/state.ts";
import { readRealizedSpend } from "../src/server/realized-spend.ts";
import { setupWorld, type World } from "./no-double-count-helpers.ts";

export const TODAY = "2026-11-11";

export type Bank = World & {
  card: string;
  pending: (o: {
    local: string;
    date: string;
    description: string;
    cents: number;
    group?: string;
  }) => Promise<string>;
};

// Mundo com conta corrente, cartão (fecha 13, vence 20: compra de 25/10 pesa
// em novembro) e as contas ligadas ao banco, para criar linhas pendentes.
export async function bankWorld(db: PGlite, tag: string, today = TODAY): Promise<Bank> {
  const w = await setupWorld(db, tag, today);
  const { familyId, userId } = { familyId: w.user.familyId, userId: w.user.userId };
  const card = randomUUID();
  await db.query(
    "INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,'Cartão','Teste','BRL','card',$3)",
    [card, familyId, userId],
  );
  await db.query("INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')", [familyId, userId]);
  const connection = randomUUID();
  await db.query(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'T','T','2026-01-01')",
    [connection, familyId, userId, randomUUID()],
  );
  const bankOf = new Map<string, string>();
  for (const [local, type] of [[w.bank, "BANK"], [card, "CREDIT"]] as const) {
    const id = randomUUID();
    bankOf.set(local, id);
    await db.query(
      "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'C','BRL',$5,$6)",
      [id, familyId, connection, randomUUID(), type, local],
    );
  }
  await saveCardCycle(db, w.user, { account_id: card, close_date: "2026-10-13", due_date: "2026-10-20" }, { today: "2026-10-01" });
  const pending: Bank["pending"] = async (o) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,operation_type,payload_hash,last_seen_run,status,analysis)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL','POSTED','','synthetic',$9,'pending',$10::jsonb)`,
      [id, familyId, bankOf.get(o.local), o.local, randomUUID(), o.date, o.description, o.cents, randomUUID(), JSON.stringify(o.group ? { group: o.group } : {})],
    );
    return id;
  };
  return { ...w, card, pending };
}

export const stateOf = (w: World, month: string) => readState(w.db, w.user, month + "-01", "BRL", undefined, undefined, false);
export const stateSpent = async (w: World, month: string) => {
  const { summary } = await stateOf(w, month);
  // Invariante: a composição da tela Movimentos sempre fecha com o total.
  const parts = [summary.expense_left_cents, summary.expense_scheduled_cents, summary.expense_card_cents];
  assert.equal(parts.reduce((s, c) => s + BigInt(c), 0n).toString(), summary.expense_cents);
  return summary.expense_cents;
};
export const realized = (w: World, from: string, to: string) =>
  asUser(w.db, w.user.userId, (tx) => readRealizedSpend(tx, { familyId: w.user.familyId, from, to }));
export const total = (rows: readonly { cents: bigint }[]) => rows.reduce((s, r) => s + r.cents, 0n);

// SONDA: linha de consumo NEGATIVO sintética (evento `expense` com valor
// positivo). Hoje nenhum leitor devolve estorno, então isto simula o que os
// consumidores receberiam depois da correção, sem alterar src/.
export async function negativeRow(w: World, o: { date: string; cents: number; category?: string }) {
  const id = randomUUID();
  await asUser(w.db, w.user.userId, async (tx) => {
    await tx.query(
      `INSERT INTO economic_events(id,household_id,account_id,category_id,kind,transaction_date,description,original_description,amount_cents,currency,created_by)
       VALUES($1,$2,$3,$4,'expense',$5,'SONDA ESTORNO','SONDA ESTORNO',$6,'BRL',$7)`,
      [id, w.user.familyId, w.bank, o.category ?? w.market, o.date, o.cents, w.user.userId],
    );
    await tx.query(
      `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
       VALUES($1,$2,$3,$4,NULL,'BRL',$5,$6),($7,$2,$3,NULL,'expense','BRL',$8,$6)`,
      [randomUUID(), w.user.familyId, id, w.bank, o.cents, o.date, randomUUID(), -o.cents],
    );
  });
}
