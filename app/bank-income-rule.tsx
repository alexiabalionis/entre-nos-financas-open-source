"use client";
import { Panel } from "./ds/panel";
import { api, type Banks, type Work } from "./bank-api";

/** Regra de entrada recorrente: explica a previsão e permite pausar. */
export function BankIncomeRule({
  rule,
  money,
  reader,
  busy,
  work,
}: {
  rule: Banks["incomeRules"][number];
  money: (value: string | null) => string;
  reader: boolean;
  busy: boolean;
  work: Work;
}) {
  return (
    <div className="bank-review border-t border-base-300 pt-4">
      <Panel title={rule.label + " · entrada recorrente"}>
        <p className="text-sm">
          {rule.receipt_mode === "business_window"
            ? "Janela esperada: primeiros cinco dias úteis, após conversão de dólares pela Wise. Data e valor variam."
            : `Dia ${rule.day}, antecipado para sexta quando cair no fim de semana.`}{" "}
          O recebimento financia{" "}
          {rule.budget_offset === 1 ? "o mês seguinte" : "o mesmo mês"}.
        </p>
        <p className="ds-caption text-xs opacity-60">
          {rule.account_name} · base {money(rule.expected_cents)} ·{" "}
          {rule.enabled ? "Ativa" : "Pausada"}. Previsões não confirmam
          receitas. Feriados e diferenças de valor precisam de revisão.
        </p>
        {!reader && (
          <button
            className="btn btn-sm btn-soft"
            disabled={busy}
            onClick={() =>
              void work(
                () =>
                  api("income/rule", {
                    account_id: rule.account_id,
                    label: rule.label,
                    match_text: rule.match_text,
                    day: rule.day,
                    expected_cents: rule.expected_cents,
                    effective_month: rule.effective_month.slice(0, 7),
                    enabled: !rule.enabled,
                    receipt_mode: rule.receipt_mode,
                    budget_offset: rule.budget_offset,
                  }),
                "Regra atualizada. Os lançamentos foram preservados.",
                true,
              )
            }
          >
            {rule.enabled ? "Pausar previsão" : "Ativar previsão"}
          </button>
        )}
      </Panel>
    </div>
  );
}
