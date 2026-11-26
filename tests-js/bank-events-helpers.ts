import { randomUUID } from "node:crypto";
import { asUser, type Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { readState } from "../src/server/state.ts";
import { readCardProjection } from "../src/server/cards.ts";
import { readBills } from "../src/server/projection-reads-bills.ts";
import { loadCardCompetence } from "../src/server/card-competence.ts";
import { analyzeBanksTx } from "../src/server/bank-analysis.ts";
import { syncBankEvents } from "../src/server/bank-card-events.ts";

// Casa sintética para docs/SPEC-FATOS-CARTAO.md: um cartão do banco (fecha dia
// 13, vence dia 20), contas extras sob demanda e as leituras usadas nas provas
// de equivalência. read() segue a leitura real: análise, depois eventos.
export async function bankEventsSetup(db: Database) {
  const email = `bank-events-${randomUUID()}@example.invalid`;
  const userId = await createFamily(db, {
    name: "Teste",
    familyName: "Casa",
    email,
    password: "Sintetica!2026abcd",
  });
  const familyId = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM members WHERE user_id=$1",
      [userId],
    )
  ).rows[0].household_id;
  const user = { userId, familyId, name: "Teste", email, role: "owner" } as Identity;
  const connection = randomUUID();
  await db.query(
    `INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')`,
    [familyId, userId],
  );
  await db.query(
    `INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2026-01-01')`,
    [connection, familyId, userId, randomUUID()],
  );
  const account = async (kind: "card" | "checking", name: string) => {
    const local = randomUUID(),
      bank = randomUUID();
    await db.query(
      `INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Teste','BRL',$4,$5)`,
      [local, familyId, name, kind, userId],
    );
    await db.query(
      `INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,$5,'BRL',$6,$7)`,
      [bank, familyId, connection, randomUUID(), name, kind === "card" ? "CREDIT" : "BANK", local],
    );
    return { local, bank };
  };
  const card = await account("card", "Cartão");
  await saveCardCycle(
    db,
    user,
    { account_id: card.local, close_date: "2026-10-13", due_date: "2026-10-20" },
    { today: "2026-10-01" },
  );
  const line = async (
    acc: { local: string; bank: string },
    date: string,
    cents: number,
    description: string,
    status = "POSTED",
  ) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL',$9,'synthetic',$10)`,
      [id, familyId, acc.bank, acc.local, randomUUID(), date, description, cents, status, randomUUID()],
    );
    return id;
  };
  const purchase = (date: string, cents: number, description: string, status = "POSTED") =>
    line(card, date, cents, description, status);
  const read = () =>
    asUser(db, user.userId, async (tx) => {
      await analyzeBanksTx(tx, user);
      return syncBankEvents(tx, user);
    });
  const analyze = () => asUser(db, user.userId, (tx) => analyzeBanksTx(tx, user));
  const numbers = async () => {
    const state = await readState(db, user, "2026-10-01", "BRL", undefined, undefined, false);
    const nov = await readState(db, user, "2026-11-01", "BRL", undefined, undefined, false);
    const bills = await asUser(db, user.userId, async (tx) =>
      (await readBills(tx, familyId, await loadCardCompetence(tx, familyId), ["2026-11"])).map((b) => [
        b.dueMonth,
        b.estimate.toString(),
      ]),
    );
    const projection = (await readCardProjection(db, user, "2026-11")).cards.map((c) => JSON.stringify(c));
    return {
      expense: nov.summary.expense_cents,
      october: { income: state.summary.income_cents, expense: state.summary.expense_cents },
      bills,
      projection,
    };
  };
  // Saldo de cada conta pelo razão (o que telas sem saldo do banco usam).
  const balances = async () =>
    Object.fromEntries(
      (
        await db.query<{ account_id: string; cents: string }>(
          "SELECT account_id,sum(amount_cents)::text AS cents FROM ledger_entries WHERE household_id=$1 AND account_id IS NOT NULL GROUP BY account_id",
          [familyId],
        )
      ).rows.map((r) => [r.account_id, r.cents]),
    );
  const status = async () =>
    new Map(
      (
        await db.query<{
          id: string;
          status: string;
          auto_recorded: boolean;
          kind: string | null;
          event_id: string | null;
          category_id: string | null;
          related_event_id: string | null;
        }>(
          `SELECT b.id,b.status,b.auto_recorded,b.event_id,e.kind,e.category_id,e.related_event_id FROM bank_transactions b LEFT JOIN economic_events e ON e.id=b.event_id WHERE b.household_id=$1`,
          [familyId],
        )
      ).rows.map((r) => [r.id, r]),
    );
  return { user, familyId, card, account, line, purchase, read, analyze, numbers, balances, status };
}
