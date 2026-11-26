import {
  billForDueMonth,
  billOf,
  ruleBill,
} from "../domain/card-competence.ts";
import {
  CARD_LOOKBACK_MONTHS,
  competenceOf,
  loadCardCompetence,
  readCardEvents,
} from "./card-competence.ts";
import { syncCurrentCycle } from "./card-cycle.ts";
import type { Database } from "./db.ts";
import { asUser } from "./db.ts";
import type { Identity } from "./auth.ts";
import { dateOnly, normalize } from "../domain/finance.ts";
import { billPayment } from "../domain/bank-analysis.ts";

export async function readCards(db: Database, u: Identity, month: string) {
  dateOnly(month + "-01");
  return asUser(db, u.userId, async (tx) => {
    // Alinha card_cycles à versão de ciclo vigente hoje antes de ler: uma
    // mudança de ciclo agendada que já venceu passa a valer nas telas.
    const syncToday = (
      await tx.query<{ today: string }>(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
      )
    ).rows[0].today;
    await syncCurrentCycle(tx, u.familyId, syncToday);
    const accounts = (
      await tx.query<{
        id: string;
        connected: boolean;
        local_account_id: string;
        name: string;
        last_four: string;
        balance_cents: string | null;
        credit_due_date: string | null;
        credit_close_date: string | null;
        read_at: string;
        bills_read_ok: boolean | null;
        credit_limit_cents: string | null;
        available_credit_cents: string | null;
        credit_limits_review: boolean;
      }>(
        `SELECT ba.id,true AS connected,ba.local_account_id,a.name,ba.last_four,ba.balance_cents::text,ba.credit_due_date::text,ba.credit_close_date::text,ba.read_at::text,ba.bills_read_ok,ba.credit_limit_cents::text,ba.available_credit_cents::text,ba.credit_limits_review FROM bank_accounts ba JOIN accounts a ON a.id=ba.local_account_id WHERE ba.household_id=$1 AND ba.account_type='CREDIT' AND ba.active ORDER BY a.name`,
        [u.familyId],
      )
    ).rows;
    const unconnected = (
      await tx.query<{ id: string; name: string }>(
        `SELECT a.id,a.name FROM accounts a WHERE a.household_id=$1 AND a.kind='card' AND NOT EXISTS(SELECT 1 FROM bank_accounts ba WHERE ba.household_id=a.household_id AND ba.local_account_id=a.id AND ba.account_type='CREDIT' AND ba.active) ORDER BY a.name`,
        [u.familyId],
      )
    ).rows;
    for (const a of unconnected)
      accounts.push({
        id: a.id,
        connected: false,
        local_account_id: a.id,
        name: a.name,
        last_four: "",
        balance_cents: null,
        credit_due_date: null,
        credit_close_date: null,
        read_at: "",
        bills_read_ok: null,
        credit_limit_cents: null,
        available_credit_cents: null,
        credit_limits_review: false,
      });
    const bills = (
      await tx.query<{
        id: string;
        bank_account_id: string;
        remote_id: string;
        due_date: string;
        close_date: string | null;
        total_cents: string | null;
        raw_total: string;
        needs_review: boolean;
        read_at: string;
      }>(
        `SELECT id,bank_account_id,remote_id,due_date::text,close_date::text,total_cents::text,raw_total,needs_review,read_at::text FROM bank_card_bills WHERE household_id=$1 AND due_date>=$2::date AND due_date<($2::date+interval '1 month') ORDER BY due_date`,
        [u.familyId, month + "-01"],
      )
    ).rows;
    const cycles = (
      await tx.query<{
        account_id: string;
        closing_day: number;
        due_day: number;
        due_month_offset: number;
        effective_close_date: string;
        effective_due_date: string;
      }>(
        `SELECT account_id,closing_day,due_day,due_month_offset,effective_close_date::text,effective_due_date::text FROM card_cycles WHERE household_id=$1`,
        [u.familyId],
      )
    ).rows;
    const manualSettings = (
      await tx.query<{ account_id: string; limit_cents: string | null }>(
        "SELECT account_id,limit_cents::text FROM manual_card_settings WHERE household_id=$1",
        [u.familyId],
      )
    ).rows;
    const manualBills = (
      await tx.query<{
        account_id: string;
        amount_cents: string;
        due_date: string;
        paid: boolean;
      }>(
        "SELECT account_id,amount_cents::text,due_date::text,paid FROM manual_card_bills WHERE household_id=$1 AND month=$2::date",
        [u.familyId, month + "-01"],
      )
    ).rows;
    const rows = (
      await tx.query<{
        id: string;
        bank_account_id: string;
        transaction_date: string;
        description: string;
        amount_cents: string;
        provider_status: string;
        status: string;
        event_id: string | null;
        changed: boolean;
        missing: boolean;
        operation_type: string;
        card_meta: {
          bill_id?: string;
          installment_number?: number;
          total_installments?: number;
        };
        analysis: { group?: string; category_suggestion?: string };
      }>(
        `SELECT b.id,b.bank_account_id,b.transaction_date::text,b.description,b.amount_cents::text,b.provider_status,b.status,b.event_id,b.changed,b.missing,b.operation_type,b.card_meta,b.analysis FROM bank_transactions b JOIN bank_accounts a ON a.id=b.bank_account_id WHERE b.household_id=$1 AND a.account_type='CREDIT' AND (b.transaction_date>=($2::date-make_interval(months=>$3)) AND b.transaction_date<($2::date+interval '1 month') OR b.card_meta->>'bill_id' IN (SELECT remote_id::text FROM bank_card_bills WHERE household_id=$1 AND due_date>=$2::date AND due_date<($2::date+interval '1 month'))) ORDER BY b.transaction_date DESC,b.id`,
        [u.familyId, month + "-01", CARD_LOOKBACK_MONTHS],
      )
    ).rows;
    // Registrado no mês pela competência (fatura que vence nele), não pela
    // data da compra: a mesma regra do orçamento.
    const competence = await loadCardCompetence(tx, u.familyId);
    const registeredByAccount = new Map<string, bigint>();
    for (const e of await readCardEvents(tx, competence, {
      familyId: u.familyId,
      month: month + "-01",
      currency: "BRL",
    }))
      if (
        e.budget.month === month &&
        ["card_purchase", "expense", "fee", "refund"].includes(e.kind)
      )
        registeredByAccount.set(
          e.account_id,
          (registeredByAccount.get(e.account_id) ?? 0n) -
            BigInt(e.amount_cents),
        );
    const registered = [...registeredByAccount].map(([account_id, cents]) => ({
      account_id,
      cents: cents.toString(),
    }));
    // Hoje no fuso do app, uma vez. Serve para separar a versão de ciclo
    // vigente da agendada e para derivar o fechamento da fatura aberta.
    const today = (
      await tx.query<{ today: string }>(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
      )
    ).rows[0].today;
    return accounts.map((a) => {
      const observations = rows.filter(
        (r) => r.bank_account_id === a.id && r.status !== "ignored",
      );
      const purchases = observations.filter(
        (r) =>
          BigInt(r.amount_cents) < 0n &&
          !billPayment(normalize(r.description), normalize(r.operation_type)),
      );
      const payments = observations.filter(
        (r) =>
          BigInt(r.amount_cents) > 0n &&
          billPayment(normalize(r.description), normalize(r.operation_type)),
      );
      const current = purchases.filter((r) =>
        r.transaction_date.startsWith(month),
      );
      const sum = (rs: typeof purchases) =>
        rs
          .reduce(
            (n, r) =>
              n +
              (BigInt(r.amount_cents) < 0n
                ? -BigInt(r.amount_cents)
                : BigInt(r.amount_cents)),
            0n,
          )
          .toString();
      const cycle = cycles.find((c) => c.account_id === a.local_account_id);
      // Ciclo vigente e eventual mudança agendada, para a tela mostrar o que
      // vale hoje e o que passa a valer, e permitir cancelar a agendada.
      const versions = a.local_account_id
        ? (competence.versions.get(a.local_account_id) ?? [])
        : [];
      const activeVersion =
        [...versions].reverse().find((v) => v.valid_from <= today) ?? null;
      const scheduledVersion =
        versions.find((v) => v.valid_from > today) ?? null;
      const openBill = activeVersion ? billOf(today, activeVersion) : null;
      const scheduledBill =
        scheduledVersion && scheduledVersion.first_due_month
          ? ruleBill(scheduledVersion.first_due_month, scheduledVersion)
          : null;
      const cycleSchedule = openBill
        ? {
            open_close_date: openBill.closeDate,
            open_due_date: openBill.dueDate,
            scheduled: scheduledVersion
              ? {
                  valid_from: scheduledVersion.valid_from,
                  first_close_date: scheduledBill?.closeDate ?? null,
                  first_due_date: scheduledBill?.dueDate ?? null,
                  closing_day: scheduledVersion.closing_day,
                  due_day: scheduledVersion.due_day,
                }
              : null,
          }
        : null;
      // Fatura do mês pela versão do ciclo que a governa; as compras sem
      // fatura do banco entram nela pela competência (mesma regra do orçamento).
      const bill = a.local_account_id
        ? billForDueMonth(
            competence.versions.get(a.local_account_id) ?? [],
            month,
          )
        : null;
      const period = bill
        ? {
            start_date: bill.startDate,
            close_date: bill.closeDate,
            due_date: bill.dueDate,
            needs_review: false,
          }
        : null;
      const estimatedPurchases = period
        ? purchases.filter(
            (r) =>
              !r.card_meta.bill_id &&
              competenceOf(competence, {
                account_id: a.local_account_id!,
                bank_account_id: r.bank_account_id,
                transaction_date: r.transaction_date,
                card_meta: r.card_meta,
              }).month === month &&
              !r.changed &&
              !r.missing &&
              r.analysis.group !== "duplicate",
          )
        : [];
      const projection = period
        ? {
            ...period,
            total_cents: sum(estimatedPurchases),
            purchase_count: estimatedPurchases.length,
            bank_pending_count: estimatedPurchases.filter(
              (r) => r.provider_status !== "POSTED",
            ).length,
            closing_day_count: estimatedPurchases.filter(
              (r) => r.transaction_date === period.close_date,
            ).length,
            purchase_ids: estimatedPurchases.map((r) => r.id),
          }
        : null;
      return {
        ...a,
        manual_limit_cents:
          manualSettings.find((s) => s.account_id === a.local_account_id)
            ?.limit_cents ?? null,
        manual_bill:
          manualBills.find((b) => b.account_id === a.local_account_id) ?? null,
        cycle: cycle ?? null,
        cycle_schedule: cycleSchedule,
        projection,
        committed_credit_cents:
          !a.credit_limits_review &&
          a.credit_limit_cents !== null &&
          a.available_credit_cents !== null
            ? (
                BigInt(a.credit_limit_cents) - BigInt(a.available_credit_cents)
              ).toString()
            : null,
        bills: bills
          .filter((b) => b.bank_account_id === a.id)
          .map((b) => ({
            ...b,
            assigned_purchase_cents: sum(
              purchases.filter((r) => r.card_meta.bill_id === b.remote_id),
            ),
            assigned_count: purchases.filter(
              (r) => r.card_meta.bill_id === b.remote_id,
            ).length,
          })),
        unassigned_cents: sum(
          purchases.filter(
            (r) =>
              !r.card_meta.bill_id &&
              !projection?.purchase_ids.includes(r.id) &&
              !r.transaction_date.startsWith(month) &&
              !r.event_id &&
              !r.changed &&
              !r.missing,
          ),
        ),
        purchases,
        payments,
        registered_cents:
          registered.find((r) => r.account_id === a.local_account_id)?.cents ??
          "0",
        history_match_cents: sum(
          current.filter(
            (r) =>
              !r.event_id &&
              r.analysis.group === "history" &&
              !r.changed &&
              !r.missing,
          ),
        ),
        duplicate_cents: sum(
          current.filter(
            (r) =>
              !r.event_id &&
              r.analysis.group === "duplicate" &&
              !r.changed &&
              !r.missing,
          ),
        ),
        preview_cents: sum(
          current.filter(
            (r) =>
              !r.event_id &&
              !["history", "duplicate"].includes(r.analysis.group ?? "") &&
              r.provider_status === "POSTED" &&
              !r.changed &&
              !r.missing,
          ),
        ),
        bank_pending_cents: sum(
          current.filter(
            (r) =>
              !r.event_id &&
              r.provider_status !== "POSTED" &&
              !r.changed &&
              !r.missing,
          ),
        ),
        review_count: observations.filter(
          (r) => !r.event_id || r.changed || r.missing,
        ).length,
      };
    });
  });
}

// Projeção de faturas futuras por cartão (AC3.2). Caminho 1 (decisão 5 da spec):
// o mês de vencimento de cada compra vem do BANCO quando a compra tem bill_id e
// a fatura foi lida (bank_card_bills.due_date); senão cai no CICLO configurado
// (janela de fechamento -> mês de vencimento). O horizonte (decisão 6) vai do
// mês corrente até a última fatura conhecida (maior vencimento entre bills lidas
// e vencimentos derivados das compras). Nada aqui registra lançamento: é só
// leitura/estimativa, fora dos totais confirmados até a fatura ser aprovada.
export async function readCardProjection(
  db: Database,
  u: Identity,
  month: string,
) {
  dateOnly(month + "-01");
  return asUser(db, u.userId, async (tx) => {
    const cards = (
      await tx.query<{
        bank_account_id: string;
        local_account_id: string;
        name: string;
        last_four: string;
        closing_day: number;
        due_day: number;
        due_month_offset: number;
      }>(
        `SELECT ba.id AS bank_account_id,ba.local_account_id,a.name,ba.last_four,
          c.closing_day,c.due_day,c.due_month_offset
         FROM bank_accounts ba
         JOIN accounts a ON a.id=ba.local_account_id
         JOIN card_cycles c ON c.household_id=ba.household_id AND c.account_id=ba.local_account_id
         WHERE ba.household_id=$1 AND ba.account_type='CREDIT' AND ba.active
         ORDER BY a.name`,
        [u.familyId],
      )
    ).rows;
    if (!cards.length) return { month, cards: [] as CardProjection[] };
    const competence = await loadCardCompetence(tx, u.familyId);
    // Faturas lidas do banco: bill_id (remote_id) -> vencimento + total.
    const bills = (
      await tx.query<{
        bank_account_id: string;
        remote_id: string;
        due_date: string;
        total_cents: string | null;
      }>(
        `SELECT bank_account_id,remote_id::text,due_date::text,total_cents::text
         FROM bank_card_bills WHERE household_id=$1`,
        [u.familyId],
      )
    ).rows;
    // Compras de cartão não ignoradas, não pagamento, com ou sem evento: aprovar
    // ou registrar automaticamente não muda a fatura (SPEC-FATOS-CARTAO).
    const purchases = (
      await tx.query<{
        bank_account_id: string;
        transaction_date: string;
        amount_cents: string;
        provider_status: string;
        changed: boolean;
        missing: boolean;
        operation_type: string;
        description: string;
        card_meta: {
          bill_id?: string;
          installment_number?: number;
          total_installments?: number;
          purchase_date?: string;
        };
        analysis: { group?: string };
      }>(
        `SELECT b.bank_account_id,b.transaction_date::text,b.amount_cents::text,
          b.provider_status,b.changed,b.missing,b.operation_type,b.description,b.card_meta,b.analysis
         FROM bank_transactions b
         JOIN bank_accounts a ON a.id=b.bank_account_id
         WHERE b.household_id=$1 AND a.account_type='CREDIT'
           AND b.status<>'ignored'
           AND NOT b.changed AND NOT b.missing
           AND b.amount_cents<0
           AND coalesce(b.analysis->>'group','') NOT IN ('duplicate','history')
         ORDER BY b.transaction_date`,
        [u.familyId],
      )
    ).rows;
    const abs = (v: string) => (BigInt(v) < 0n ? -BigInt(v) : BigInt(v));
    return {
      month,
      cards: cards.map((card): CardProjection => {
        const billDue = new Map<string, string>(); // remote_id -> due_date
        const billTotal = new Map<string, bigint>(); // só faturas com total oficial
        const billInReview = new Set<string>(); // total_cents null (fatura em revisão)
        for (const b of bills)
          if (b.bank_account_id === card.bank_account_id) {
            billDue.set(b.remote_id, b.due_date);
            // Fatura em revisão não tem total oficial (total_cents null): não
            // pode entrar na soma (BigInt(null) quebra); marca o mês como
            // provisório e sua soma oficial é pulada.
            if (b.total_cents === null) billInReview.add(b.remote_id);
            else billTotal.set(b.remote_id, BigInt(b.total_cents));
          }
        const mine = purchases.filter(
          (r) =>
            r.bank_account_id === card.bank_account_id &&
            !billPayment(normalize(r.description), normalize(r.operation_type)),
        );
        // Mês de vencimento pela MESMA regra do orçamento (cardCompetence):
        // fatura do banco, depois a versão do ciclo vigente na compra.
        const dueMonthOf = (r: (typeof mine)[number]) =>
          competenceOf(competence, {
            account_id: card.local_account_id,
            bank_account_id: r.bank_account_id,
            transaction_date: r.transaction_date,
            card_meta: r.card_meta,
          }).month;
        // Agrupa por mês de vencimento, do mês corrente em diante.
        const byMonth = new Map<
          string,
          {
            bank_cents: bigint;
            cycle_cents: bigint;
            provisional: boolean;
            count: number;
          }
        >();
        const slotFor = (dueMonth: string) => {
          let slot = byMonth.get(dueMonth);
          if (!slot) {
            slot = {
              bank_cents: 0n,
              cycle_cents: 0n,
              provisional: false,
              count: 0,
            };
            byMonth.set(dueMonth, slot);
          }
          return slot;
        };
        for (const r of mine) {
          const dueMonth = dueMonthOf(r);
          if (!dueMonth || dueMonth < month) continue;
          const bid = r.card_meta.bill_id;
          const fromBank = !!(bid && billDue.has(bid));
          const slot = slotFor(dueMonth);
          // Compra vinculada a uma fatura do banco NÃO soma seu valor parcial:
          // o total do mês é o total OFICIAL da fatura (abaixo) + compras sem
          // fatura. Só compras avulsas (sem bill_id lido) entram pelo ciclo.
          if (!fromBank) slot.cycle_cents += abs(r.amount_cents);
          if (r.provider_status !== "POSTED") slot.provisional = true;
          slot.count++;
        }
        // Faturas lidas do banco que vencem no mês corrente ou depois: o total
        // OFICIAL (billTotal) define bank_cents do mês. Fatura em revisão (sem
        // total) é pulada da soma e marca o mês como provisório.
        for (const [bid, due] of billDue) {
          const dueMonth = due.slice(0, 7);
          if (dueMonth < month) continue;
          const slot = slotFor(dueMonth);
          if (billInReview.has(bid)) slot.provisional = true;
          else slot.bank_cents += billTotal.get(bid) ?? 0n;
        }
        const months = [...byMonth.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([due_month, s]) => {
            const total = s.bank_cents + s.cycle_cents;
            const source: "bank" | "cycle" | "partial" =
              s.bank_cents > 0n && s.cycle_cents > 0n
                ? "partial"
                : s.bank_cents > 0n
                  ? "bank"
                  : "cycle";
            return {
              due_month,
              total_cents: total.toString(),
              bank_cents: s.bank_cents.toString(),
              cycle_cents: s.cycle_cents.toString(),
              source,
              provisional: s.provisional,
              purchase_count: s.count,
            };
          });
        return {
          account_id: card.local_account_id,
          name: card.name,
          last_four: card.last_four,
          months,
        };
      }),
    };
  });
}
type CardProjection = {
  account_id: string;
  name: string;
  last_four: string;
  months: {
    due_month: string;
    total_cents: string;
    bank_cents: string;
    cycle_cents: string;
    source: "bank" | "cycle" | "partial";
    provisional: boolean;
    purchase_count: number;
  }[];
};
