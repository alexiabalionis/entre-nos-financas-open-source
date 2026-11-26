import { brDate } from "../../../src/domain/format.ts";
import { monthTitle } from "../../lib/dates.ts";
import { frequencyText, monthName } from "../fixed-actions-model.ts";
import type { OverviewReview, OverviewSeries } from "./overview-types.ts";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ABBREVIATIONS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const weekday = (iso: string): number =>
  new Date(`${iso}T00:00:00Z`).getUTCDay();

export function shortDate(iso: string): string {
  return brDate(iso).slice(0, 5);
}

/** "Qua 11/11": o dia de uma ocorrência, para a lista de várias vezes no mês. */
export function occurrenceTitle(iso: string): string {
  return `${ABBREVIATIONS[weekday(iso)]} ${shortDate(iso)}`;
}

/** "Todo mês, dia 5", "Toda sexta", "A cada 2 meses". */
export function frequencyDescription(
  series: Pick<OverviewSeries, "frequency" | "every" | "start_date">,
): string {
  const { frequency, every, start_date } = series;
  if (every > 1) {
    const text = frequencyText(frequency, every);
    return text[0].toUpperCase() + text.slice(1);
  }
  if (frequency === "day") return "Todo dia";
  if (frequency === "month") return `Todo mês, dia ${Number(start_date.slice(8, 10))}`;
  if (frequency === "year") return `Todo ano, ${shortDate(start_date)}`;
  const day = weekday(start_date);
  return `${day === 0 || day === 6 ? "Todo" : "Toda"} ${WEEKDAYS[day]}`;
}

/** "próxima 05/12"; anual leva o ano porque a próxima pode ser só no ano que vem. */
export function nextLabel(
  series: Pick<OverviewSeries, "frequency" | "next_date">,
): string {
  if (series.next_date === null) return "sem próxima data";
  return `próxima ${series.frequency === "year" ? brDate(series.next_date) : shortDate(series.next_date)}`;
}

/** "termina 26/11/2026" quando a série tem fim; vazio sem fim. Sem isso, uma
 * série que acaba logo parecia continuar e as edições "não pegavam". */
export function endLabel(series: Pick<OverviewSeries, "end_date">): string {
  return series.end_date ? `termina ${brDate(series.end_date)}` : "";
}

/**
 * Série no cartão: "no Nubank · entra na fatura de dezembro, vence 05/12".
 * A data da série é a da cobrança; quem paga é a fatura.
 */
export function cardBillLabel(
  card: { name: string; next_month: string | null; next_due_date: string | null } | null,
): string | null {
  if (!card) return null;
  if (!card.next_month) return `no ${card.name}`;
  const due = card.next_due_date ? `, vence ${shortDate(card.next_due_date)}` : "";
  return `no ${card.name} · entra na fatura de ${monthName(`${card.next_month}-01`)}${due}`;
}

export function reviewSummary(count: number): string {
  return count === 1
    ? "1 previsão pode estar no mês errado."
    : `${count} previsões podem estar no mês errado.`;
}

export function reviewDetail(review: OverviewReview): string {
  const due = review.suggested_due_date
    ? `Vence em ${brDate(review.suggested_due_date)}.`
    : "Fica sem vencimento no novo mês.";
  return `Hoje conta em ${monthTitle(review.current_month)}. Pela data da fatura, o certo é ${monthTitle(review.suggested_month)}. ${due}`;
}

export function reviewButton(review: OverviewReview): string {
  return `Mover para ${monthName(`${review.suggested_month}-01`)}`;
}

export function activeCaption(active: number): string {
  return active === 1 ? "1 conta fixa ativa" : `${active} contas fixas ativas`;
}

export function occurrencesToggle(count: number): string {
  return count === 1 ? "Ver a ocorrência" : `Ver as ${count} ocorrências`;
}

export function monthsText(months: number): string {
  return months === 1 ? "em 1 mês" : `em ${months} meses`;
}

export const EMPTY_TEXT =
  "Você ainda não tem contas fixas. Em Movimentos, abra um gasto que se repete e escolha Virar conta fixa.";

export const dismissedNotice = (label: string): string =>
  `Combinado, não vamos sugerir ${label} de novo.`;

export const suggestionCreatedNotice = (label: string): string =>
  `Pronto, ${label} virou conta fixa.`;

export const convertedNotice = (label: string): string =>
  `${label} agora é conta fixa. As próximas serão criadas sozinhas.`;
