import type { BudgetReference } from "../../src/server/budget-reference.ts";
import type { Money } from "./budget-view-model.ts";

export const NO_REFERENCE =
  "Ainda não há meses fechados suficientes para sugerir.";

// A sugestão arredonda a mediana PARA CIMA em R$ 10 (1.413,20 vira 1.420,00):
// um teto redondo, que não nasce já apertado em relação ao normal.
const STEP = 1000n;

export function suggestedCeiling(medianCents: bigint): bigint {
  return ((medianCents + STEP - 1n) / STEP) * STEP;
}

export type ReferenceView = {
  text: string;
  /** Centavos do botão "Usar"; null quando não há o que sugerir. */
  suggestion: bigint | null;
};

/** Texto e valor sugerido da referência. O valor segue 'ocultar valores' via fmt. */
export function referenceView(
  ref: BudgetReference | null,
  fmt: Money,
): ReferenceView {
  if (ref === null || ref.median_cents === null || ref.max_cents === null)
    return { text: NO_REFERENCE, suggestion: null };
  const normal = suggestedCeiling(BigInt(ref.median_cents));
  return {
    text: `Nos últimos ${ref.months.length} meses, o normal foi ${fmt(normal)} por mês (o maior foi ${fmt(BigInt(ref.max_cents))}).`,
    suggestion: normal,
  };
}
