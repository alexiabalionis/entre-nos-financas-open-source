import { plainMoney } from "../../src/domain/format.ts";
import type { Frequency } from "../../src/domain/recurrence.ts";
import { fixedPayload, validateFixed, type FixedFormErrors, type FixedFormValues } from "./fixed-form-model.ts";

type EditSource = {
  label: string;
  planned_cents: string | null;
  category_id: string | null;
  recurrence: { frequency: Frequency; every: number; occurrence_date: string; end_date?: string | null };
};

/** Valores iniciais do "Editar conta fixa", a partir da conta deste mês. */
export function seriesEditValues(item: EditSource): FixedFormValues {
  const { frequency, every, occurrence_date } = item.recurrence;
  const simple = every === 1 && frequency !== "day";
  // "A cada N anos" vira "a cada 12N meses": o formulário não tem unidade ano.
  const customEvery = frequency === "year" ? every * 12 : every;
  return {
    label: item.label,
    frequency: simple ? frequency : "custom",
    every: String(customEvery),
    unit: frequency === "year" ? "month" : frequency,
    amount: item.planned_cents ? plainMoney(item.planned_cents) : "",
    startDate: occurrence_date,
    categoryId: item.category_id ?? "",
    // O fim atual da série aparece no campo: apagar é o jeito de tirar o fim.
    endDate: item.recurrence.end_date ?? "",
  };
}

/**
 * Erros do formulário. A data pode ser antes desta conta: aí a edição vale a
 * partir dela (ver `editFrom`); o servidor recusa se passar do fim da versão
 * anterior.
 */
export function seriesEditErrors(v: FixedFormValues, _from: string): FixedFormErrors {
  const all = validateFixed(v, { date: "0000-01-01" });
  delete all.since;
  return all;
}

/** De onde a edição vale: desta conta, ou da nova data se ela vier antes. */
export function editFrom(changes: Record<string, unknown> | null, from: string): string {
  const start = changes?.start_date;
  return typeof start === "string" && start < from ? start : from;
}

/** O que muda na série, no formato de `recurrences/apply`; null enquanto há erro. */
export function seriesChanges(v: FixedFormValues, from: string): Record<string, unknown> | null {
  if (Object.keys(seriesEditErrors(v, from)).length) return null;
  const p = fixedPayload({ ...v, since: "" }, { date: v.startDate < from ? v.startDate : from, eventId: "" });
  if (!p) return null;
  return {
    label: p.label,
    expected_cents: p.expected_cents,
    frequency: p.frequency,
    every: p.every,
    start_date: p.start_date,
    ...(p.category_id ? { category_id: p.category_id } : {}),
    // Sempre explícito: campo vazio tira o fim. Omitido, a versão nova
    // herdava o fim da anterior sem a pessoa ver (o campo aparecia vazio).
    end_date: p.end_date ?? null,
  };
}

/**
 * Série no cartão: a data é a da cobrança, não a do pagamento. Uma data depois
 * do fechamento joga a conta para a fatura seguinte.
 */
export function cardDateHint(card: string, dueDate: string | null): string {
  const due = dueDate ? ` (esta vence em ${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)})` : "";
  return `Cobrada no ${card}: é paga junto com a fatura${due}. Use o dia em que a cobrança aparece no cartão, não o dia em que você paga a fatura. Depois do fechamento, ela passa para a fatura seguinte.`;
}
