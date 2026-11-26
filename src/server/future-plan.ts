import type { Transaction } from "@electric-sql/pglite";
import { asUser, type Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { goalBalance } from "../domain/reserve.ts";
import { expectedDate, occurrencesBetween } from "../domain/recurrence.ts";
import { reconcileBill } from "../domain/projection-bills.ts";
import type { Quality } from "../domain/projection-reconcile-shared.ts";
import {
  projectFuture,
  type CardFuture,
  type CardInstallment,
  type FutureInput,
  type FutureResult,
  type GoalFuture,
  type Line,
  type MonthAmount,
} from "../domain/future-months.ts";
import { loadCardCompetence } from "./card-competence.ts";
import { readToday } from "./projection.ts";
import { readCashSnapshot } from "./projection-reads-cash.ts";
import { readBillsDetailed } from "./projection-reads-bills.ts";
import { resolveCategory } from "./assisted.ts";
import { normalize } from "../domain/finance.ts";
import {
  RECURRENCE_COLUMNS,
  generatedItem,
  loadDatesResolver,
  toRule,
  type RecurrenceRow,
} from "./recurrence-sync.ts";
import type { Wire } from "./copilot.ts";
import { readBankCover } from "./fixed-bank-cover.ts";
import { readRealizedSpend } from "./realized-spend.ts";
import { categoryPeriods, monthSummary } from "../domain/insights.ts";
import { readMonthFlows } from "./insights.ts";
import { addDays } from "../domain/day.ts";
import { readable } from "./projection-reads-recurrences.ts";

// Copiloto "Futuro": monta, por família, a entrada de projectFuture a partir
// dos leitores que o app já tem (saldo, recorrências, faturas e parcelas,
// reservas, dia a dia) e roda a projeção. Só leitura, uma transação. Nenhuma
// regra de cálculo existente muda: aqui só se reúne o que os leitores devolvem.

const DEFAULT_MONTHS = 24;

type OccurrenceRow = {
  recurrence_id: string;
  occurrence_date: string;
  match_state: string;
  item_id: string;
  month: string;
  planned_cents: string | null;
  paid_cents: string | null;
  status: string;
  event_id: string | null;
  archived: boolean;
};

// Texto de cobrança para comparar série e extrato: sem o "05/12" que o banco
// muda a cada mês (seguro parcelado, assinatura anual em parcelas).
const chargeText = (t: string) => normalize(t.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, " ")).replace(/\s+/g, " ").trim();

type CardRecurring = {
  card: string;
  month: string;
  key: string;
  label: string;
  cents: bigint;
  category?: string;
  /** Texto do extrato da série: diz se a cobrança já está lançada na fatura. */
  match: string;
};

const monthKey = (m: string) => m.slice(0, 7);

function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function bucket(map: Map<string, Line[]>, month: string, line: Line) {
  map.set(month, [...(map.get(month) ?? []), line]);
}

function toAmounts(map: Map<string, Line[]>, months: string[]): MonthAmount[] {
  return months.flatMap((month) => {
    const items = map.get(month) ?? [];
    if (!items.length) return [];
    return [{ month, cents: items.reduce((s, i) => s + i.cents, 0n), items }];
  });
}

const left = (planned: string | null, paid: string | null): bigint => {
  const rest = BigInt(planned ?? "0") - BigInt(paid ?? "0");
  return rest > 0n ? rest : 0n;
};

// Entradas e contas fixas: ocorrências das séries ativas e itens manuais do plano.
async function readSeriesAndItems(
  tx: Transaction,
  familyId: string,
  months: string[],
  today: string,
) {
  const horizon = new Set(months);
  const resolver = await loadDatesResolver(tx, familyId);
  // Conta fixa cujo Pix/débito já saiu da conta (linha do banco ainda sem
  // lançamento): já está fora do saldo de partida, então conta como paga.
  // Agendado (data futura) segue a pagar; cartão segue pela fatura (match).
  const cover = await readBankCover(tx, familyId, months.slice(0, 1));
  const leftAccount = (itemId: string) => {
    const c = cover.get(itemId);
    return c !== undefined && c.source === "checking" && c.transaction_date <= today;
  };
  const rules = (
    await tx.query<RecurrenceRow>(
      `SELECT ${RECURRENCE_COLUMNS} FROM recurrences WHERE household_id=$1 AND NOT paused`,
      [familyId],
    )
  ).rows;
  const occurrences = (
    await tx.query<OccurrenceRow>(
      `SELECT o.recurrence_id,o.occurrence_date::text,o.match_state,i.id AS item_id,i.month::text AS month,
         i.planned_cents::text,i.paid_cents::text,i.status,i.event_id,i.archived
       FROM recurrence_occurrences o
       JOIN monthly_items i ON i.household_id=o.household_id AND i.id=o.monthly_item_id
       WHERE o.household_id=$1`,
      [familyId],
    )
  ).rows;
  const materialized = new Map(occurrences.map((o) => [`${o.recurrence_id}|${o.occurrence_date}`, o]));
  const categoryNames = new Map(
    (await tx.query<{ id: string; name: string }>("SELECT id::text,name FROM categories WHERE household_id=$1", [familyId])).rows.map(
      (c) => [c.id, c.name],
    ),
  );
  const from = shiftMonth(months[0], -1) + "-01";
  const through = endOfMonth(shiftMonth(months[months.length - 1], 1));

  const income = new Map<string, Line[]>();
  const fixed = new Map<string, Line[]>();
  // Contas fixas já pagas (no todo ou em parte): só para mostrar o mês inteiro.
  // Já saíram do saldo de partida, então não entram de novo na conta.
  const paid = new Map<string, Line[]>();
  const cardRecurring: CardRecurring[] = [];

  for (const r of rules) {
    const dates = resolver(r);
    for (const date of occurrencesBetween(toRule(r), from, through)) {
      const key = `rec:${r.id}:${date}`;
      const item = materialized.get(`${r.id}|${date}`);
      let month: string;
      let cents: bigint;
      let paidCents = 0n;
      if (item) {
        // O item gerado manda: respeita a edição de valor e o que já foi pago.
        // Ocorrência cancelada (item arquivado) não volta pela regra.
        if (item.archived) continue;
        const planned = item.planned_cents ?? r.expected_cents;
        const settled =
          item.status === "done" ||
          item.event_id !== null ||
          item.match_state === "detected" ||
          leftAccount(item.item_id);
        month = monthKey(item.month);
        if (r.purpose === "income") {
          if (settled) continue;
          cents = BigInt(planned);
        } else {
          cents = settled ? 0n : left(planned, item.paid_cents);
          paidCents = settled ? BigInt(item.paid_cents ?? planned) : BigInt(planned) - cents;
        }
      } else {
        const generated = generatedItem(r, date, dates);
        month = monthKey(generated.month);
        cents = BigInt(r.expected_cents);
      }
      // O Futuro é caixa: entrada e conta fixa fora do cartão contam no mês em
      // que o dinheiro entra ou sai (data esperada), não no mês de planejamento
      // (o salário do dia 25 que a aba Mês planeja para o mês seguinte entra
      // aqui no próprio mês). Recorrente no cartão segue a competência da fatura.
      const cashDate = expectedDate(toRule(r), date);
      if (r.purpose === "income" || !(dates && r.account_id)) month = cashDate.slice(0, 7);
      if (!horizon.has(month)) continue;
      if (paidCents > 0n && r.purpose !== "income" && !(dates && r.account_id))
        bucket(paid, month, { key, label: r.label, cents: paidCents, source: "recorrencia", date: cashDate });
      if (cents <= 0n) continue;
      if (r.purpose === "income") {
        bucket(income, month, { key, label: r.label, cents, source: "recorrencia", date: cashDate });
      } else if (dates && r.account_id) {
        const category = r.category_id ? categoryNames.get(r.category_id) : undefined;
        cardRecurring.push({
          card: r.account_id, month, key, label: r.label, cents, match: r.match_text ?? r.label, ...(category ? { category } : {}),
        });
      } else {
        bucket(fixed, month, { key, label: r.label, cents, source: "recorrencia", date: cashDate });
      }
    }
  }

  // Itens manuais do plano (fora de série): despesa e entrada ainda em aberto.
  const manual = (
    await tx.query<{
      id: string;
      label: string;
      purpose: string;
      month: string;
      planned_cents: string;
      paid_cents: string | null;
      due_date: string | null;
      status: string;
      event_id: string | null;
    }>(
      `SELECT i.id,i.label,i.purpose,i.month::text,i.planned_cents::text,i.paid_cents::text,i.due_date::text,i.status,i.event_id
       FROM monthly_items i
       WHERE i.household_id=$1 AND NOT i.archived AND NOT i.derived AND i.currency='BRL'
         AND i.purpose IN ('expense','income') AND i.planned_cents IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM recurrence_occurrences o WHERE o.household_id=i.household_id AND o.monthly_item_id=i.id)`,
      [familyId],
    )
  ).rows;
  for (const i of manual) {
    const month = monthKey(i.month);
    const settled = i.status === "done" || i.event_id !== null;
    if (!horizon.has(month) || (settled && i.purpose === "income")) continue;
    const cents = settled ? 0n : i.purpose === "income" ? BigInt(i.planned_cents) : left(i.planned_cents, i.paid_cents);
    if (i.purpose === "expense") {
      const paidCents = settled ? BigInt(i.paid_cents ?? i.planned_cents) : BigInt(i.planned_cents) - cents;
      if (paidCents > 0n)
        bucket(paid, month, { key: `item:${i.id}`, label: i.label, cents: paidCents, source: "plano", ...(i.due_date ? { date: i.due_date } : {}) });
    }
    if (cents <= 0n) continue;
    bucket(i.purpose === "income" ? income : fixed, month, { key: `item:${i.id}`, label: i.label, cents, source: "plano", ...(i.due_date ? { date: i.due_date } : {}) });
  }
  return {
    income: toAmounts(income, months),
    fixed: toAmounts(fixed, months),
    paidFixed: toAmounts(paid, months),
    cardRecurring,
  };
}

// Faturas por cartão: o mesmo total que o motor usa (reconcileBill, depois dos
// pagamentos já feitos), as parcelas por compra e os recorrentes do cartão.
async function readCards(
  tx: Transaction,
  familyId: string,
  today: string,
  months: string[],
  cardRecurring: CardRecurring[],
): Promise<CardFuture[]> {
  const horizon = new Set(months);
  const competence = await loadCardCompetence(tx, familyId);
  const detail = await readBillsDetailed(tx, familyId, competence, months);
  const names = new Map(
    (await tx.query<{ id: string; name: string }>("SELECT id,name FROM accounts WHERE household_id=$1 AND kind='card'", [familyId])).rows.map(
      (a) => [a.id, a.name],
    ),
  );
  // Categoria de cada parcela lida: a do lançamento aprovado; sem ele, a regra
  // do estabelecimento (a mesma que a média do dia a dia usa). Compras avulsas
  // do "resto" da fatura (leftoverLines) entram pela mesma resolução, pra não
  // cair tudo num "Outras compras" sem categoria.
  const ids = [...detail.lines.map((l) => l.id), ...detail.leftoverLines.map((l) => l.id)];
  const [approved, rules] = await Promise.all([
    ids.length
      ? tx.query<{ id: string; name: string; display_name: string | null; description: string }>(
          `SELECT b.id::text,c.name,e.display_name,e.description FROM bank_transactions b
           JOIN economic_events e ON e.household_id=b.household_id AND e.id=b.event_id
           JOIN categories c ON c.household_id=e.household_id AND c.id=e.category_id
           WHERE b.household_id=$1 AND b.id::text=ANY($2::text[])`,
          [familyId, ids],
        )
      : Promise.resolve({ rows: [] as { id: string; name: string; display_name: string | null; description: string }[] }),
    tx.query<{ match_text: string; category_name: string }>(
      "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
      [familyId],
    ),
  ]);
  const approvedCategory = new Map(approved.rows.map((r) => [r.id, r.name]));
  const approvedBy = new Map(approved.rows.map((r) => [r.id, r]));
  // O nome que a pessoa deu ao lançamento; sem ele, o texto do banco legível.
  const nameOfLine = (l: (typeof detail.lines)[number]) => {
    const e = approvedBy.get(l.id);
    if (e?.display_name) return e.display_name;
    if (e && e.description !== l.description) return e.description;
    return readable(l.description);
  };
  const categoryOfLine = (l: (typeof detail.lines)[number]) =>
    approvedCategory.get(l.id) ?? resolveCategory(rules.rows, l.description).name;
  const leftoverCategoriesByKey = new Map<string, Map<string, bigint>>();
  for (const l of detail.leftoverLines) {
    const key = `${l.card}|${l.month}`;
    const name = approvedCategory.get(l.id) ?? resolveCategory(rules.rows, l.description).name;
    const byName = leftoverCategoriesByKey.get(key) ?? new Map<string, bigint>();
    byName.set(name, (byName.get(name) ?? 0n) + l.cents);
    leftoverCategoriesByKey.set(key, byName);
  }
  const lineOf = (key: string) =>
    detail.lines.find((l) => key.startsWith(`inst:${l.card}:${l.purchaseDate ?? l.id}:${l.n}:${l.merchant}:`));
  const labelOf = (key: string) => {
    const l = lineOf(key);
    return l ? nameOfLine(l) : "Parcelamento";
  };
  const categoryOf = (key: string) => {
    const line = lineOf(key);
    return line ? categoryOfLine(line) : undefined;
  };
  const cards = new Set<string>([
    ...detail.bills.map((b) => b.card),
    ...cardRecurring.map((r) => r.card),
    ...detail.series.map((s) => s.card),
  ]);

  // Recorrente que é parcelamento (seguro em 12x): o extrato traz "06/12".
  // A última cobrança é o mês dessa linha + (n − k); depois dela a série não cobra.
  const lastCharge = (card: string, match: string): string | null => {
    const want = chargeText(match);
    let last: string | null = null;
    for (const [key, texts] of detail.estimateTexts) {
      const [c, month] = key.split("|");
      if (c !== card) continue;
      for (const t of texts) {
        if (!chargeText(t).includes(want)) continue;
        const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(t);
        if (!m) continue;
        const k = Number(m[1]);
        const n = Number(m[2]);
        if (k < 1 || n < 2 || k > n) continue;
        const end = shiftMonth(month, n - k);
        if (last === null || end > last) last = end;
      }
    }
    return last;
  };

  return [...cards].sort().map((card) => {
    // Parcelas: as derivadas (futuras) e as já lançadas, agrupadas pela série.
    const rows: Omit<CardInstallment, "lastMonth">[] = [];
    const lastOf = new Map<string, string>();
    const track = (key: string, month: string) => {
      if (!lastOf.has(key) || lastOf.get(key)! < month) lastOf.set(key, month);
    };
    const seriesOf = (line: (typeof detail.lines)[number]) =>
      detail.series.find((s) => s.card === card && s.key.startsWith(`inst:${card}:${line.purchaseDate ?? line.id}:${line.n}:${line.merchant}:`));
    for (const s of detail.series.filter((x) => x.card === card)) {
      const n = Number(s.key.split(":")[3]);
      const label = labelOf(s.key);
      const category = categoryOf(s.key);
      for (const d of s.derived) {
        track(s.key, d.dueMonth);
        // Parcelas depois do horizonte entram: contam como compromisso futuro.
        if (d.dueMonth >= months[0])
          rows.push({ key: s.key, label, cents: d.cents, k: d.k, n, month: d.dueMonth, ...(category ? { category } : {}) });
      }
    }
    for (const l of detail.lines.filter((x) => x.card === card && x.month)) {
      const key = seriesOf(l)?.key ?? `obs:${l.id}`;
      track(key, l.month!);
      if (horizon.has(l.month!))
        rows.push({ key, label: nameOfLine(l), cents: l.cents, k: l.k, n: l.n, month: l.month!, category: categoryOfLine(l) });
    }
    const installments = rows
      .map((r) => ({ ...r, lastMonth: lastOf.get(r.key) ?? r.month }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.k - b.k || a.key.localeCompare(b.key));

    // No mês atual só aparece o recorrente já lançado (o resto não soma na fatura).
    const postedNow = (detail.estimateTexts.get(`${card}|${months[0]}`) ?? []).map(chargeText);
    const recurring = cardRecurring.filter(
      (r) =>
        r.card === card &&
        r.month <= (lastCharge(card, r.match) ?? r.month) &&
        (r.month !== months[0] || postedNow.some((t) => t.includes(chargeText(r.match)))),
    );
    const bills = detail.bills
      .filter((b) => b.card === card && horizon.has(b.dueMonth))
      .map((b) => {
        const flows = reconcileBill(b, today);
        const total = flows.reduce((s, f) => s + f.cons.cents, 0n);
        const ofMonth = recurring.filter((r) => r.month === b.dueMonth);
        const recurringSum = ofMonth.reduce((s, r) => s + r.cents, 0n);
        let final: bigint;
        if (b.bankTotal !== null || b.manual !== null) {
          // Valor da fatura informado (banco ou manual): os recorrentes já estão
          // dentro; só o que passa dele entra.
          final = recurringSum > total ? recurringSum : total;
        } else {
          // Estimativa pelas compras lançadas: soma o recorrente que ainda não
          // apareceu no ciclo (o que já foi cobrado está nas compras).
          // No mês atual, só o que já foi lançado (decisão da pessoa).
          const texts = (detail.estimateTexts.get(`${card}|${b.dueMonth}`) ?? []).map(chargeText);
          const pending =
            b.dueMonth === months[0]
              ? 0n
              : ofMonth.filter((r) => !texts.some((t) => t.includes(chargeText(r.match)))).reduce((s, r) => s + r.cents, 0n);
          final = total + pending;
        }
        const quality: Quality = flows[0]?.quality ?? "estimated";
        const leftover = leftoverCategoriesByKey.get(`${card}|${b.dueMonth}`);
        return {
          month: b.dueMonth,
          total: final,
          quality,
          source: b.bankTotal !== null ? ("banco" as const) : b.manual !== null ? ("manual" as const) : ("estimado" as const),
          ...(b.bankTotal === null && b.manual === null && leftover
            ? { leftoverCategories: [...leftover].map(([name, cents]) => ({ name, cents })) }
            : {}),
        };
      });
    // Mês só com recorrente no cartão (sem fatura nenhuma): entra como estimativa.
    for (const m of new Set(recurring.map((r) => r.month)))
      if (horizon.has(m) && m !== months[0] && !bills.some((b) => b.month === m))
        bills.push({
          month: m,
          total: recurring.filter((r) => r.month === m).reduce((s, r) => s + r.cents, 0n),
          quality: "estimated",
          source: "estimado",
        });
    return {
      card,
      name: names.get(card) ?? "Cartão",
      cycles: competence.versions.get(card) ?? [],
      bills: bills.sort((a, b) => a.month.localeCompare(b.month)),
      installments,
      recurring: recurring.map((r) => ({
        key: r.key, label: r.label, cents: r.cents, month: r.month, ...(r.category ? { category: r.category } : {}),
      })),
    };
  });
}

async function readGoals(tx: Transaction, familyId: string, today: string): Promise<GoalFuture[]> {
  const goals = (
    await tx.query<{
      id: string;
      name: string;
      status: "active" | "paused";
      location: "same_account" | "elsewhere" | null;
      target_cents: string;
      deadline_month: string | null;
      priority: number;
    }>(
      `SELECT id,name,status,location,target_cents::text,to_char(deadline_month,'YYYY-MM') AS deadline_month,priority
       FROM goals WHERE household_id=$1 AND status IN ('active','paused') ORDER BY priority,created_at`,
      [familyId],
    )
  ).rows;
  const movements = (
    await tx.query<{ goal_id: string; plan_id: string | null; kind: "deposit" | "withdrawal"; cents: string; bank_transaction_id: string | null; voided: boolean }>(
      `SELECT goal_id,plan_id,kind,cents::text,bank_transaction_id,voided_at IS NOT NULL AS voided
       FROM reserve_movements WHERE household_id=$1`,
      [familyId],
    )
  ).rows;
  const plans = (
    await tx.query<{ id: string; goal_id: string; month: string; planned_cents: string }>(
      `SELECT id,goal_id,to_char(month,'YYYY-MM') AS month,planned_cents::text FROM reserve_plans
       WHERE household_id=$1 AND superseded_by IS NULL ORDER BY month`,
      [familyId],
    )
  ).rows;
  const start = today.slice(0, 7);
  return goals.map((g) => {
    const mine = movements.filter((m) => m.goal_id === g.id);
    const saved = goalBalance(mine.map((m) => ({ kind: m.kind, cents: BigInt(m.cents), bank_transaction_id: m.bank_transaction_id, voided: m.voided }))).saved;
    const list = plans.filter((p) => p.goal_id === g.id).map((p) => ({ id: p.id, month: p.month, planned: BigInt(p.planned_cents) }));
    // No mês corrente só falta o que ainda não foi separado para o plano.
    const current = list.find((p) => p.month === start);
    const deposited = current
      ? mine.filter((m) => !m.voided && m.kind === "deposit" && m.plan_id === current.id).reduce((s, m) => s + BigInt(m.cents), 0n)
      : 0n;
    const out = list.map((p) => ({ month: p.month, planned: p.month === start && deposited > 0n ? (p.planned > deposited ? p.planned - deposited : 0n) : p.planned }));
    // Sem plano no mês seguinte, o aporte cheio volta (o restante vale só para este mês).
    if (current && deposited > 0n && !list.some((p) => p.month === shiftMonth(start, 1)))
      out.push({ month: shiftMonth(start, 1), planned: current.planned });
    return {
      id: g.id,
      name: g.name,
      status: g.status,
      location: g.location,
      target: BigInt(g.target_cents),
      saved,
      deadlineMonth: g.deadline_month,
      priority: g.priority,
      plans: out,
    };
  });
}

// Sinais do mês corrente por categoria: gasto até hoje, mesmos dias do mês
// passado e teto planejado (BRL). Mesma fonte do Panorama.
async function readSignals(tx: Transaction, familyId: string, today: string) {
  const month = today.slice(0, 7);
  // Mesma janela do Panorama (12 meses até hoje): a sobra dos meses fechados
  // decide o que cabe no Simular; o mês por categoria sai do mesmo gasto.
  const scope = { familyId, from: `${shiftMonth(month, -11)}-01`, to: addDays(today, 1) };
  const spend = await readRealizedSpend(tx, scope);
  const rows = categoryPeriods(spend, today).month;
  const flows = await readMonthFlows(tx, scope, spend);
  const summary = monthSummary(flows, month);
  const closed = flows.filter((m) => m.month < month && (m.in > 0n || m.out > 0n));
  const budgets = await tx.query<{ name: string; planned: string }>(
    `SELECT c.name,b.planned_cents::text AS planned FROM budgets b
     JOIN categories c ON c.household_id=b.household_id AND c.id=b.category_id
     WHERE b.household_id=$1 AND b.month=$2::date AND b.currency='BRL' AND b.planned_cents IS NOT NULL`,
    [familyId, `${month}-01`],
  );
  const planned = new Map(budgets.rows.map((r) => [r.name, BigInt(r.planned)]));
  return {
    categories: rows.map((r) => ({
      name: r.name,
      cents: r.cents,
      prev: r.prev,
      budget: planned.get(r.name) ?? null,
    })),
    history: summary
      ? { avg: summary.keptAvg, kept: closed.map((m) => ({ month: m.month, cents: m.in - m.out })) }
      : null,
  };
}

export async function readFuture(
  db: Database,
  user: Identity,
  opts: { months?: number; today?: string } = {},
): Promise<{ input: FutureInput; result: FutureResult }> {
  const months = opts.months ?? DEFAULT_MONTHS;
  if (!Number.isInteger(months) || months < 3 || months > 36)
    throw new UserError("Escolha entre 3 e 36 meses.");
  return asUser(db, user.userId, async (tx) => {
    const today = opts.today ?? (await readToday(tx));
    const startMonth = today.slice(0, 7);
    const list = Array.from({ length: months }, (_, i) => shiftMonth(startMonth, i));

    const snapshot = await readCashSnapshot(tx, user.familyId);
    const goals = await readGoals(tx, user.familyId, today);
    const series = await readSeriesAndItems(tx, user.familyId, list, today);
    const cards = await readCards(tx, user.familyId, today, list, series.cardRecurring);

    // Dia a dia: não é projetado (decisão da pessoa, 15/11/2026). A folga do
    // mês é o que sobra para ele depois das contas fixas e da fatura.
    const everyday = { weekly: null, source: "ausente" as const };

    const separated = goals
      .filter((g) => g.location === "same_account" && g.saved > 0n)
      .reduce((s, g) => s + g.saved, 0n);
    const fixedAvg =
      series.fixed.slice(0, 12).reduce((s, m) => s + m.cents, 0n) / BigInt(Math.max(1, Math.min(12, list.length)));
    const everydayMonthly = everyday.weekly === null ? 0n : (everyday.weekly * 52n) / 12n;

    const premises: string[] = [
      "Itens de cartão planejados à mão não entram: a fatura vem do banco e das parcelas.",
      "Contas fixas e entradas vêm das séries ativas; itens já pagos ou recebidos ficam de fora.",
    ];
    if (snapshot.snapshotDate === null)
      premises.push("Sem saldo confirmado: a projeção parte de zero.");
    else if (snapshot.snapshotDate < today)
      premises.push(`O saldo foi lido em ${snapshot.snapshotDate.split("-").reverse().join("/")}: movimentos desde então podem não estar refletidos.`);
    if (snapshot.unbounded.length)
      premises.push("Há conta no caixa sem saldo informado: ela não entra no ponto de partida.");
    for (const g of goals.filter((x) => x.location === null && x.saved > 0n))
      premises.push(`Não sabemos onde está "${g.name}": tratada como fora da conta. Se estiver na conta, o saldo livre é menor.`);

    const signals = await readSignals(tx, user.familyId, today);
    const input: FutureInput = {
      today,
      startMonth,
      months,
      startBalance: snapshot.sConf - separated,
      snapshotDate: snapshot.snapshotDate,
      income: series.income,
      fixed: series.fixed,
      paidFixed: series.paidFixed,
      everyday,
      cards,
      goals,
      essentialsMonthly: fixedAvg + everydayMonthly,
      premises,
      signals,
    };
    return { input, result: projectFuture(input) };
  });
}

export type FutureRead = Awaited<ReturnType<typeof readFuture>>;
export type FutureWire = Wire<FutureRead>;

function stringify(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringify);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stringify(v)]));
  return value;
}
export function toFutureWire(read: FutureRead): FutureWire {
  return stringify(read) as FutureWire;
}
