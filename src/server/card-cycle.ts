import { randomUUID } from "node:crypto";
import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { asUser, recordAudit, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import {
  firstBill,
  planCycleSave,
  toCycleVersions,
  type NewVersion,
  type VersionRow,
} from "../domain/card-cycle-versions.ts";
import { billOf, type CycleVersion } from "../domain/card-competence.ts";
import { UserError } from "./imports.ts";

const VERSION_COLUMNS =
  "id,account_id,closing_day,due_day,due_month_offset,valid_from::text,to_char(first_due_month,'YYYY-MM') AS first_due_month";

/** Versões de ciclo por cartão (local account id), prontas para cardCompetence. */
export async function readCycleVersions(
  tx: Transaction,
  familyId: string,
): Promise<Map<string, CycleVersion[]>> {
  const rows = (
    await tx.query<VersionRow & { account_id: string }>(
      `SELECT ${VERSION_COLUMNS} FROM card_cycle_versions WHERE household_id=$1 ORDER BY account_id,valid_from`,
      [familyId],
    )
  ).rows;
  const byAccount = new Map<string, VersionRow[]>();
  for (const r of rows) {
    const list = byAccount.get(r.account_id) ?? [];
    list.push(r);
    byAccount.set(r.account_id, list);
  }
  return new Map(
    [...byAccount].map(([account, list]) => [account, toCycleVersions(list)]),
  );
}

/** Versão de ciclo vigente hoje (a última com valid_from<=today). */
function activeVersionToday(versions: readonly CycleVersion[], today: string) {
  return [...versions].reverse().find((v) => v.valid_from <= today) ?? null;
}

/**
 * Alinha card_cycles (a config lida pelas telas e pelos lembretes) à versão de
 * ciclo vigente HOJE em card_cycle_versions. Uma versão agendada que já venceu
 * passa a valer: sem este passo, card_cycles continuaria no ciclo antigo. As
 * datas efetivas vêm da fatura aberta hoje (billOf). Idempotente: só atualiza
 * quando a regra vigente difere da gravada. Respeita o CHECK de card_cycles
 * (dia das datas efetivas == closing_day/due_day): se a fatura aberta cair em
 * mês curto que force clamp (o dia derivado não bate com o da regra), não
 * grava — card_cycles fica no estado anterior até uma fatura sem clamp.
 */
export async function syncCurrentCycle(
  tx: Transaction,
  familyId: string,
  today: string,
) {
  const versions = await readCycleVersions(tx, familyId);
  const current = (
    await tx.query<{
      account_id: string;
      closing_day: number;
      due_day: number;
      due_month_offset: number;
    }>(
      "SELECT account_id,closing_day,due_day,due_month_offset FROM card_cycles WHERE household_id=$1",
      [familyId],
    )
  ).rows;
  const currentByAccount = new Map(current.map((c) => [c.account_id, c]));
  for (const [accountId, list] of versions) {
    const active = activeVersionToday(list, today);
    if (!active) continue;
    const row = currentByAccount.get(accountId);
    if (
      row &&
      row.closing_day === active.closing_day &&
      row.due_day === active.due_day &&
      row.due_month_offset === active.due_month_offset
    )
      continue;
    const bill = billOf(today, active);
    if (!bill) continue;
    // CHECK de card_cycles exige dia exato; fatura clampada em mês curto é pulada.
    if (
      Number(bill.closeDate.slice(8, 10)) !== active.closing_day ||
      Number(bill.dueDate.slice(8, 10)) !== active.due_day
    )
      continue;
    await tx.query(
      `UPDATE card_cycles SET closing_day=$1,due_day=$2,due_month_offset=$3,effective_close_date=$4,effective_due_date=$5,updated_at=now() WHERE household_id=$6 AND account_id=$7`,
      [
        active.closing_day,
        active.due_day,
        active.due_month_offset,
        bill.closeDate,
        bill.dueDate,
        familyId,
        accountId,
      ],
    );
  }
}

function versionValues(row: NewVersion) {
  return [
    row.closing_day,
    row.due_day,
    row.due_month_offset,
    row.valid_from,
    row.first_due_month + "-01",
  ];
}

export async function saveCardCycle(
  db: Database,
  u: Identity,
  raw: unknown,
  options: { today?: string } = {},
) {
  if (!["owner", "editor"].includes(u.role))
    throw new UserError("Seu acesso é somente para leitura.");
  const v = z
    .object({
      account_id: z.uuid(),
      close_date: z.string().max(10),
      due_date: z.string().max(10),
    })
    .strict()
    .parse(raw);
  return asUser(db, u.userId, async (tx) => {
    const account = (
      await tx.query(
        "SELECT id FROM accounts WHERE id=$1 AND household_id=$2 AND kind='card'",
        [v.account_id, u.familyId],
      )
    ).rows[0];
    if (!account) throw new UserError("Escolha um cartão da família.");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "card-cycle:" + u.familyId + v.account_id,
    ]);
    const today =
      options.today ??
      (
        await tx.query<{ today: string }>(
          "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
        )
      ).rows[0].today;
    const rows = (
      await tx.query<VersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM card_cycle_versions WHERE household_id=$1 AND account_id=$2 ORDER BY valid_from`,
        [u.familyId, v.account_id],
      )
    ).rows;
    // A validação e a regra (dia de fechamento, vencimento, offset) vêm só do
    // planejador; as duas gravações abaixo usam o mesmo resultado.
    const plan = planCycleSave(rows, v, today);
    if (plan.action === "error") throw new UserError(plan.message);
    const before =
      "replaces" in plan ? rows.find((r) => r.id === plan.replaces) : undefined;
    let versionId: string | null = before?.id ?? null;
    if (plan.action === "create" || plan.action === "schedule") {
      versionId = randomUUID();
      await tx.query(
        `INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          versionId,
          u.familyId,
          v.account_id,
          ...versionValues(plan.row),
          u.userId,
        ],
      );
    } else if (
      plan.action === "replace_first" ||
      plan.action === "replace_future"
    ) {
      await tx.query(
        `UPDATE card_cycle_versions SET closing_day=$1,due_day=$2,due_month_offset=$3,valid_from=$4,first_due_month=$5 WHERE id=$6 AND household_id=$7`,
        [...versionValues(plan.row), plan.replaces, u.familyId],
      );
    } else if (plan.action === "cancel_future") {
      await tx.query(
        "DELETE FROM card_cycle_versions WHERE id=$1 AND household_id=$2",
        [plan.replaces, u.familyId],
      );
    }
    // card_cycles segue sendo lida por state.ts/cards.ts até a K2. Só recebe
    // o ciclo que vale já; versões futuras não alteram os leitores atuais.
    if (plan.action === "create" || plan.action === "replace_first")
      await tx.query(
        `INSERT INTO card_cycles(household_id,account_id,closing_day,due_day,due_month_offset,effective_close_date,effective_due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(household_id,account_id) DO UPDATE SET closing_day=excluded.closing_day,due_day=excluded.due_day,due_month_offset=excluded.due_month_offset,effective_close_date=excluded.effective_close_date,effective_due_date=excluded.effective_due_date,updated_at=now()`,
        [
          u.familyId,
          v.account_id,
          plan.row.closing_day,
          plan.row.due_day,
          plan.row.due_month_offset,
          v.close_date,
          v.due_date,
          u.userId,
        ],
      );
    const row = "row" in plan ? plan.row : null;
    const bill = row ? firstBill(row) : null;
    const summary = {
      valid_from: row?.valid_from ?? null,
      first_close_date: bill?.closeDate ?? null,
      first_due_date: bill?.dueDate ?? null,
    };
    await recordAudit(tx, u.familyId, u.userId, "card.cycle", v.account_id, {
      close_date: v.close_date,
      due_date: v.due_date,
      source: "family",
      financial_events_created: 0,
      plan_action: plan.action,
      version_id: versionId,
      ...summary,
      before: before ?? null,
    });
    return { ok: true, action: plan.action, ...summary };
  });
}
