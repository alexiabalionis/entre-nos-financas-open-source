import { monthName } from "../fixed/fixed-actions-model.ts";
import { moveMonth, monthTitle } from "../lib/dates.ts";

export const CEILING_ERROR = "Digite o valor do teto, por exemplo 1.800,00.";

export type BudgetDraft = { categoryId: string; from: string; value: string };

const AMOUNT = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

/** Centavos de um valor digitado; null para vazio, zero, negativo ou fora do formato. */
export function parseCeiling(text: string): bigint | null {
  const t = text.trim();
  if (t.length > 20 || !AMOUNT.test(t)) return null;
  const [whole, fraction = ""] = t.replace(/\./g, "").split(",");
  const cents = BigInt(whole + fraction.padEnd(2, "0"));
  return cents > 0n ? cents : null;
}

export function ceilingError(text: string): string {
  return parseCeiling(text) === null ? CEILING_ERROR : "";
}

/** Valor no formato que a rota aceita (1234,56). */
function planned(cents: bigint): string {
  return `${cents / 100n},${String(cents % 100n).padStart(2, "0")}`;
}

/** Valor para o campo de texto, com milhar (3.500,00). */
export function ceilingInput(cents: bigint): string {
  const whole = String(cents / 100n).replace(/\B(?=(\d{3})+$)/g, ".");
  return `${whole},${String(cents % 100n).padStart(2, "0")}`;
}

export type BudgetPayload = {
  category_id: string;
  month: string;
  currency: string;
  planned: string | null;
};

export function savePayload(
  draft: BudgetDraft,
  currency: string,
): BudgetPayload | null {
  const cents = parseCeiling(draft.value);
  return cents === null
    ? null
    : {
        category_id: draft.categoryId,
        month: draft.from,
        currency,
        planned: planned(cents),
      };
}

export function removePayload(
  draft: BudgetDraft,
  currency: string,
): BudgetPayload {
  return {
    category_id: draft.categoryId,
    month: draft.from,
    currency,
    planned: null,
  };
}

export function fromOptions(viewed: string) {
  return [0, 1, 2].map((n) => {
    const value = moveMonth(viewed, n);
    const title = monthTitle(value);
    return {
      value,
      label: title[0].toUpperCase() + title.slice(1) + (n === 0 ? " (este mês)" : ""),
    };
  });
}

const cap = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Explica a partir de quando o teto vale, e o que o mês visto mantém. */
export function validFromText(
  from: string,
  viewed: string,
  currentCeiling: string | null,
): string {
  const tail = "segue valendo nos meses seguintes até você mudar.";
  if (from === viewed)
    return `Vale de ${monthTitle(from)} em diante. ${cap(tail)}`;
  const before =
    currentCeiling !== null
      ? `${cap(monthName(viewed))} continua com ${currentCeiling}. `
      : `${cap(monthName(viewed))} continua sem teto. `;
  return `${before}Vale de ${monthTitle(from)} em diante, e ${tail}`;
}

export function removeLabel(from: string, viewed: string): string {
  return from === viewed
    ? "Tirar o teto a partir deste mês"
    : `Tirar o teto a partir de ${monthTitle(from)}`;
}

export function removeBody(
  name: string,
  ceiling: string,
  from: string,
  viewed: string,
): string {
  const first =
    from === viewed
      ? `A partir de ${monthTitle(from)}, ${name} deixa de ter teto e some da lista de tetos do mês.`
      : `${name} continua com o teto de ${ceiling} até o fim de ${monthName(viewed)}. A partir de ${monthTitle(from)}, deixa de ter teto.`;
  return `${first} Os meses anteriores continuam com o teto que tinham. Os gastos e as contas da categoria não mudam.`;
}

export function savedNotice(
  name: string,
  amount: string,
  from: string,
  viewed: string,
): string {
  return from === viewed
    ? `Teto de ${name}: ${amount}, a partir de ${monthTitle(from)}. Segue valendo nos meses seguintes até você mudar.`
    : `${cap(monthName(viewed))} continua como está. ${name} passa a ter teto de ${amount} a partir de ${monthTitle(from)}.`;
}

export function removedNotice(name: string, from: string, viewed: string): string {
  return from === viewed
    ? `Teto de ${name} retirado a partir de ${monthTitle(from)}.`
    : `${name} continua com o teto até o fim de ${monthName(viewed)} e fica sem teto a partir de ${monthTitle(from)}.`;
}
