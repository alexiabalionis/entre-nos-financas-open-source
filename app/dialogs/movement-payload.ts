import { cents } from "../../src/domain/finance.ts";
import { plainMoney } from "../../src/domain/format.ts";

/** Tipos que movem dinheiro entre duas contas (saiu de -> foi para). */
const PAIRED_KINDS = [
  "transfer",
  "fx",
  "card_payment",
  "investment_buy",
  "investment_sell",
];
/** Tipos que entram como valor positivo; os demais saem (negativo). */
const POSITIVE_KINDS = ["income", "investment_sell", "yield"];

export function isPairedKind(kind: string): boolean {
  return PAIRED_KINDS.includes(kind);
}

/**
 * Corpo de POST `events` a partir dos campos do formulário. Aplica o sinal do
 * valor (gasto sai, entrada entra) e zera categoria/contrapartida conforme o
 * tipo. Devolve null quando o valor digitado não é um valor válido.
 */
export function movementBody(
  values: Record<string, FormDataEntryValue>,
  kind: string,
  counterAccountId: string,
  counterCurrency: string | undefined,
): Record<string, unknown> | null {
  let amount: bigint;
  try {
    amount = cents(String(values.amount));
  } catch {
    return null;
  }
  const paired = isPairedKind(kind);
  const negative = !POSITIVE_KINDS.includes(kind);
  const signed = (negative ? -1n : 1n) * (amount < 0n ? -amount : amount);
  return {
    ...values,
    kind,
    amount: plainMoney(signed.toString()),
    category_id: paired ? null : values.category_id || null,
    counter_account_id: paired ? counterAccountId : null,
    counter_currency: kind === "fx" ? counterCurrency : null,
    counter_amount: kind === "fx" ? values.counter_amount : null,
    related_event_id: null,
  };
}
