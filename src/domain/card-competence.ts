import {
  cardCyclePeriod,
  dueMonthFromCycle,
  shiftMonth,
} from "./card-cycle.ts";
import { dateOnly } from "./finance.ts";

export type CycleRule = {
  closing_day: number;
  due_day: number;
  due_month_offset: 0 | 1;
};
// Versão do ciclo do cartão. valid_from/valid_until delimitam as datas de
// COMPRA cobertas (inclusive). Sem versão vigente não há inferência: o ciclo
// atual nunca é estendido para o passado. first_due_month (YYYY-MM) indica a
// primeira fatura da versão; as datas dela vêm da própria regra, então a
// âncora não diverge do ciclo. Depois de uma troca, essa fatura é de
// transição: cobre de valid_from até o seu fechamento.
export type CycleVersion = CycleRule & {
  valid_from: string;
  valid_until: string | null;
  first_due_month?: string;
};
export type Bill = { month: string; closeDate: string; dueDate: string };
export type CompetenceInput = {
  transactionDate: string;
  purchaseDate?: string | null;
  billDueDate?: string | null;
  declaredDueDate?: string | null;
  installment?: { number: number; total: number } | null;
  cycles: readonly CycleVersion[];
};
export type CompetenceSource =
  "bill" | "declared" | "cycle" | "installment_cycle" | "unknown";
export type Competence = {
  month: string | null;
  dueDate: string | null;
  source: CompetenceSource;
  reason: string;
  conflict: { cycleMonth: string } | null;
};

type Inference = { month: string; dueDate: string } | { failure: string };

function versionAt(cycles: readonly CycleVersion[], date: string) {
  return (
    cycles.find(
      (v) =>
        v.valid_from <= date &&
        (v.valid_until === null || date <= v.valid_until),
    ) ?? null
  );
}

function dayAfter(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Fatura de um mês de vencimento pela regra. Quando o vencimento, cortado no
 * fim de um mês curto (ex. 28/30 em fevereiro não bissexto, ambos caindo em
 * 28/02), fica no mesmo dia do fechamento ou antes, o vencimento passa a ser o
 * dia seguinte ao fechamento — assim a fatura nunca some e as compras do ciclo
 * continuam tendo competência. O mês da fatura segue sendo o mês pedido.
 */
export function ruleBill(month: string, rule: CycleRule): Bill | null {
  const period = cardCyclePeriod(
    month,
    rule.closing_day,
    rule.due_day,
    rule.due_month_offset,
  );
  const dueDate = period.needs_review
    ? dayAfter(period.close_date)
    : period.due_date;
  return { month, closeDate: period.close_date, dueDate };
}

/** Fatura que contém uma compra numa versão do ciclo, deslocada `shift` meses. */
export function billOf(
  date: string,
  version: CycleRule & { valid_from: string; first_due_month?: string },
  shift = 0,
): Bill | null {
  const anchor = version.first_due_month
    ? ruleBill(version.first_due_month, version)
    : null;
  if (anchor && date >= version.valid_from && date <= anchor.closeDate)
    return shift === 0
      ? anchor
      : ruleBill(shiftMonth(anchor.month, shift), version);
  const month = dueMonthFromCycle(date, version);
  return month ? ruleBill(shiftMonth(month, shift), version) : null;
}

function inferFromCycle(
  base: string,
  shift: number,
  cycles: readonly CycleVersion[],
): Inference {
  const version = versionAt(cycles, base);
  if (!version) return { failure: "Sem ciclo conhecido na data da compra." };
  // A primeira fatura (a da compra) é a da versão vigente na data da compra.
  const first = billOf(base, version, 0);
  if (!first)
    return { failure: "O ciclo não define uma fatura válida para esta data." };
  if (shift === 0) return { month: first.month, dueDate: first.dueDate };
  // Parcela k>1: o mês de vencimento desloca `shift` faturas a partir da
  // primeira, e cada fatura é resolvida pela versão que a governa — assim uma
  // troca de ciclo entre a compra e a parcela segue o ciclo novo em vez de
  // extrapolar o antigo.
  const target = shiftMonth(first.month, shift);
  const bill = billForDueMonth(cycles, target);
  if (!bill)
    return { failure: "O ciclo mudou antes do fechamento desta fatura." };
  return { month: bill.month, dueDate: bill.dueDate };
}

function unknown(reason: string): Competence {
  return {
    month: null,
    dueDate: null,
    source: "unknown",
    reason,
    conflict: null,
  };
}

function validInstallment(i: { number: number; total: number }) {
  return (
    Number.isInteger(i.number) &&
    Number.isInteger(i.total) &&
    i.number >= 1 &&
    i.number <= i.total
  );
}

/**
 * Competência orçamentária de um lançamento de cartão: o mês de vencimento da
 * fatura a que ele pertence. Não depende do estado de aprovação nem da tabela
 * de origem; nunca altera a data transacional.
 */
export function cardCompetence(input: CompetenceInput): Competence {
  dateOnly(input.transactionDate);
  for (const d of [
    input.purchaseDate,
    input.billDueDate,
    input.declaredDueDate,
  ])
    if (d) dateOnly(d);
  const installment = input.installment ?? null;
  if (installment && !validInstallment(installment))
    return unknown("Parcela inválida.");
  const shift = installment ? installment.number - 1 : 0;
  const purchase = input.purchaseDate ?? null;
  // A data de lançamento de uma parcela não indica a compra: sem a data da
  // compra, a parcela só tem competência por fatura explícita.
  let inference: Inference =
    shift > 0 && !purchase
      ? { failure: "Parcela sem data da compra nem fatura identificada." }
      : inferFromCycle(purchase ?? input.transactionDate, shift, input.cycles);
  let byCharge = false;
  // Compra anterior ao primeiro ciclo conhecido (ex.: seguro em 12x comprado
  // antes do cadastro do fechamento): o banco lista cada parcela na data da
  // cobrança, então ela cai na fatura do ciclo vigente nessa data.
  if (
    !("month" in inference) &&
    shift > 0 &&
    purchase &&
    input.transactionDate !== purchase &&
    !versionAt(input.cycles, purchase)
  ) {
    const charged = inferFromCycle(input.transactionDate, 0, input.cycles);
    if ("month" in charged) {
      inference = charged;
      byCharge = true;
    }
  }
  const inferred = "month" in inference ? inference : null;
  const explicit = input.billDueDate
    ? { source: "bill" as const, date: input.billDueDate }
    : input.declaredDueDate
      ? { source: "declared" as const, date: input.declaredDueDate }
      : null;
  if (explicit) {
    const month = explicit.date.slice(0, 7);
    return {
      month,
      dueDate: explicit.date,
      source: explicit.source,
      reason:
        explicit.source === "bill"
          ? "Fatura identificada pelo banco."
          : "Vencimento registrado no lançamento.",
      conflict:
        inferred && inferred.month !== month
          ? { cycleMonth: inferred.month }
          : null,
    };
  }
  if (inferred)
    return {
      month: inferred.month,
      dueDate: inferred.dueDate,
      source: shift > 0 ? "installment_cycle" : "cycle",
      reason: byCharge
        ? "Parcela pelo ciclo vigente na data da cobrança (compra antes do ciclo conhecido)."
        : shift > 0
          ? "Parcela pelo ciclo vigente na data da compra."
          : "Ciclo vigente na data da compra.",
      conflict: null,
    };
  return unknown("failure" in inference ? inference.failure : "Sem evidência.");
}

/**
 * Fatura com vencimento no mês, pela versão do ciclo que a governa. Nunca
 * antes da primeira fatura de uma versão nem depois do fim dela; null quando
 * nenhuma versão cobre o mês.
 */
export function billForDueMonth(
  versions: readonly CycleVersion[],
  month: string,
): (Bill & { startDate: string }) | null {
  for (const v of [...versions].reverse()) {
    if (v.first_due_month && month < v.first_due_month) continue;
    const bill = ruleBill(month, v);
    if (!bill || bill.closeDate < v.valid_from) continue;
    if (v.valid_until !== null && bill.closeDate > v.valid_until) continue;
    const start =
      month === v.first_due_month
        ? v.valid_from
        : cardCyclePeriod(month, v.closing_day, v.due_day, v.due_month_offset)
            .start_date;
    return { ...bill, startDate: start };
  }
  return null;
}
