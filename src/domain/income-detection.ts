import type { Observation } from "./bank-analysis.ts";
import { normalize } from "./finance.ts";

// Decisão pura de detecção de uma entrada recorrente (detected/review/planned + nota).
// É a mesma lógica que a leitura dos bancos aplicava às regras de recebimento.

export type IncomeTarget = {
  account_id: string;
  match_text: string;
  business_window: boolean;
  expected_cents: string;
};

export type IncomeMatch = {
  bank_transaction_id: string | null;
  state: "planned" | "detected" | "review";
  note: string;
};

const MANY = "Mais de um crédito compatível: escolha o recebimento correto.";
const WISE =
  "Crédito via Wise candidato ao salário. Confira a origem do trabalho e o valor convertido; nem todo Pix Wise é salário.";
const DIVERGENT = "Data, valor ou situação divergem da regra: confira no banco.";
const DETECTED =
  "Crédito identificado no banco; aguarda sua revisão. Nenhum lançamento confirmado.";
const WINDOW_PLANNED =
  "Janela aproximada de cinco dias de semana; feriados podem alterar a estimativa. Data e valor precisam de revisão.";
const PLANNED = "Previsão de recebimento; ainda não identificado no banco.";

// `month` é o mês do recebimento (YYYY-MM); `expected` a data prevista gravada na ocorrência.
export function matchIncome(
  target: IncomeTarget,
  month: string,
  expected: string,
  bank: Observation[],
): IncomeMatch {
  const found = bank.filter(
    (b) =>
      b.local_account_id === target.account_id &&
      b.transaction_date.startsWith(month) &&
      BigInt(b.amount_cents) > 0n &&
      (normalize(b.description).includes(normalize(target.match_text)) ||
        (target.business_window && /WISE|WIZE/.test(normalize(b.description)))),
  );
  const one = found.length === 1 ? found[0] : undefined;
  const valid =
    one !== undefined &&
    one.provider_status === "POSTED" &&
    !one.changed &&
    !one.missing &&
    !target.business_window &&
    one.transaction_date === expected &&
    one.amount_cents === target.expected_cents;
  const state = found.length === 0 ? "planned" : valid ? "detected" : "review";
  const note =
    found.length > 1
      ? MANY
      : one && !valid
        ? target.business_window
          ? WISE
          : DIVERGENT
        : valid
          ? DETECTED
          : target.business_window
            ? WINDOW_PLANNED
            : PLANNED;
  return { bank_transaction_id: one?.id || null, state, note };
}
