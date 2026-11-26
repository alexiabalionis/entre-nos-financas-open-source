import {
  cardCyclePeriod,
  dueMonthFromCycle,
  shiftMonth,
} from "./card-cycle.ts";
import {
  billOf,
  ruleBill,
  type Bill,
  type CycleRule,
  type CycleVersion,
} from "./card-competence.ts";
import { dateOnly } from "./finance.ts";
import { brDate } from "./format.ts";
import { addDays } from "./day.ts";

export type { CycleRule };
export type VersionRow = CycleRule & {
  id: string;
  valid_from: string;
  first_due_month: string; // YYYY-MM
};
export type NewVersion = Omit<VersionRow, "id">;
export type CyclePlan =
  | { action: "create"; row: NewVersion }
  | { action: "replace_first"; row: NewVersion; replaces: string }
  | { action: "schedule"; row: NewVersion }
  | { action: "replace_future"; row: NewVersion; replaces: string }
  | { action: "cancel_future"; replaces: string }
  | { action: "unchanged" }
  | { action: "error"; message: string };

// Distância máxima do "próximo fechamento" digitado no primeiro cadastro.
export const MAX_NEXT_CLOSE_DAYS = 62;

function sameRule(a: CycleRule, b: CycleRule) {
  return (
    a.closing_day === b.closing_day &&
    a.due_day === b.due_day &&
    a.due_month_offset === b.due_month_offset
  );
}
const byStart = (a: { valid_from: string }, b: { valid_from: string }) =>
  a.valid_from.localeCompare(b.valid_from);

/** Primeira fatura de uma versão, derivada da regra. */
export function firstBill(row: CycleRule & { first_due_month: string }) {
  return ruleBill(row.first_due_month, row);
}

/** Versões ordenadas, com o fim de cada uma derivado do início da seguinte. */
export function toCycleVersions(rows: readonly VersionRow[]): CycleVersion[] {
  const sorted = [...rows].sort(byStart);
  return sorted.map((r, i) => ({
    closing_day: r.closing_day,
    due_day: r.due_day,
    due_month_offset: r.due_month_offset,
    valid_from: r.valid_from,
    valid_until:
      i + 1 < sorted.length ? addDays(sorted[i + 1].valid_from, -1) : null,
    first_due_month: r.first_due_month,
  }));
}

/** Regra única derivada das datas digitadas; null se forem inválidas. */
export function ruleFrom(closeDate: string, dueDate: string): CycleRule | null {
  dateOnly(closeDate);
  dateOnly(dueDate);
  const [cy, cm] = closeDate.split("-").map(Number),
    [dy, dm] = dueDate.split("-").map(Number),
    offset = (dy - cy) * 12 + dm - cm;
  if (dueDate <= closeDate || (offset !== 0 && offset !== 1)) return null;
  return {
    closing_day: Number(closeDate.slice(8)),
    due_day: Number(dueDate.slice(8)),
    due_month_offset: offset === 1 ? 1 : 0,
  };
}

// Primeira configuração. Vale desde hoje; se o fechamento digitado já passou,
// desde o dia seguinte a ele, mas nunca antes do início da fatura aberta hoje
// (o ciclo informado não é estendido a faturas já fechadas).
function firstVersion(
  rule: CycleRule,
  closeDate: string,
  today: string,
): NewVersion | { error: string } {
  const openMonth = dueMonthFromCycle(today, rule);
  const open = openMonth ? ruleBill(openMonth, rule) : null;
  if (!open) return { error: "Ciclo inválido para o mês atual." };
  const openStart = cardCyclePeriod(
    open.month,
    rule.closing_day,
    rule.due_day,
    rule.due_month_offset,
  ).start_date;
  const afterClose = addDays(closeDate, 1);
  const validFrom =
    closeDate >= today
      ? today
      : afterClose > openStart
        ? afterClose
        : openStart;
  return { ...rule, valid_from: validFrom, first_due_month: open.month };
}

// Mudança: vale a partir do dia seguinte ao fechamento da fatura aberta. A
// primeira fatura nova é a primeira do ciclo novo que fecha depois disso, num
// mês de vencimento posterior ao da fatura aberta (nunca duas no mesmo mês).
function changeVersion(
  current: CycleVersion,
  rule: CycleRule,
  today: string,
): { row: NewVersion; bill: Bill } | { error: string } {
  const open = billOf(today, current);
  if (!open) return { error: "Não foi possível identificar a fatura aberta." };
  for (let step = 1; step <= 3; step++) {
    const bill = ruleBill(shiftMonth(open.month, step), rule);
    if (!bill || bill.closeDate <= open.closeDate) continue;
    return {
      row: {
        ...rule,
        valid_from: addDays(open.closeDate, 1),
        first_due_month: bill.month,
      },
      bill,
    };
  }
  return {
    error: "Não foi possível calcular a primeira fatura do novo ciclo.",
  };
}

// Primeiro cadastro ou correção dele. Sem vigente, a nova versão toma o lugar
// de uma versão só futura, se houver (nunca duas versões ativas no cadastro).
function planFirst(
  sorted: readonly VersionRow[],
  current: VersionRow | null,
  rule: CycleRule,
  input: { close_date: string },
  today: string,
): CyclePlan {
  if (input.close_date > addDays(today, MAX_NEXT_CLOSE_DAYS))
    return {
      action: "error",
      message: `O próximo fechamento precisa estar a no máximo ${MAX_NEXT_CLOSE_DAYS} dias.`,
    };
  const next = firstVersion(rule, input.close_date, today);
  if ("error" in next) return { action: "error", message: next.error };
  const replaced = current ?? sorted[0] ?? null;
  if (!replaced) return { action: "create", row: next };
  const validFrom =
    current && current.valid_from < next.valid_from
      ? current.valid_from
      : next.valid_from;
  const month = dueMonthFromCycle(validFrom, rule);
  if (!month || !ruleBill(month, rule))
    return { action: "error", message: "Ciclo inválido para esse período." };
  return {
    action: "replace_first",
    row: { ...rule, valid_from: validFrom, first_due_month: month },
    replaces: replaced.id,
  };
}

/**
 * Decide como gravar o ciclo informado (próximo fechamento e vencimento).
 * Versões já vigentes nunca mudam, exceto a primeira enquanto a sua primeira
 * fatura não fechou (correção do cadastro).
 */
export function planCycleSave(
  rows: readonly VersionRow[],
  input: { close_date: string; due_date: string },
  today: string,
): CyclePlan {
  dateOnly(today);
  const rule = ruleFrom(input.close_date, input.due_date);
  if (!rule)
    return {
      action: "error",
      message:
        "O vencimento deve ser após o fechamento, no mesmo mês ou no seguinte.",
    };
  const sorted = [...rows].sort(byStart);
  const currentIndex = sorted.findLastIndex((r) => r.valid_from <= today);
  const current = currentIndex >= 0 ? sorted[currentIndex] : null;
  const future = sorted.find((r) => r.valid_from > today) ?? null;
  const currentFirst = current ? firstBill(current) : null;
  if (
    !current ||
    (sorted.length === 1 &&
      currentFirst !== null &&
      today <= currentFirst.closeDate)
  )
    return planFirst(sorted, current, rule, input, today);
  const live = toCycleVersions(sorted)[currentIndex];
  if (sameRule(rule, current)) {
    if (!future) return { action: "unchanged" };
    // Cancelar exige informar o fechamento atual: reenviar dados antigos da
    // tela não pode apagar uma mudança agendada sem a pessoa perceber.
    const open = billOf(today, live);
    if (open && input.close_date === open.closeDate)
      return { action: "cancel_future", replaces: future.id };
    const pending = firstBill(future);
    return {
      action: "error",
      message: `Há uma mudança de ciclo agendada a partir de ${brDate(future.valid_from)}${pending ? `, com a primeira fatura vencendo em ${brDate(pending.dueDate)}` : ""}. Para cancelá-la, informe o fechamento atual${open ? ` (${brDate(open.closeDate)})` : ""}.`,
    };
  }
  const next = changeVersion(live, rule, today);
  if ("error" in next) return { action: "error", message: next.error };
  if (
    input.close_date !== next.bill.closeDate ||
    input.due_date !== next.bill.dueDate
  )
    return {
      action: "error",
      message: `O novo ciclo vale a partir de ${brDate(next.row.valid_from)}. A primeira fatura nele fecha em ${brDate(next.bill.closeDate)} e vence em ${brDate(next.bill.dueDate)}.`,
    };
  if (future && sameRule(rule, future)) return { action: "unchanged" };
  return future
    ? { action: "replace_future", row: next.row, replaces: future.id }
    : { action: "schedule", row: next.row };
}
