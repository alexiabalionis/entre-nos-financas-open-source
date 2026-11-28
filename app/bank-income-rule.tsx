"use client";
import { Button } from "./ds/button";
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
    <div className="border-t border-border pt-4">
      <Panel title={rule.label + " · entrada recorrente"} className="mb-0">
        <p className="m-0 text-sm text-ink">
          {rule.receipt_mode === "business_window"
            ? "Janela esperada: primeiros cinco dias úteis, com data e valor variáveis."
            : `Dia ${rule.day}, antecipado para sexta quando cair no fim de semana.`}{" "}
          O recebimento financia{" "}
          {rule.budget_offset === 1 ? "o mês seguinte" : "o mesmo mês"}.
        </p>
        <p className="ds-caption">
          {rule.account_name} · base {money(rule.expected_cents)} ·{" "}
          {rule.enabled ? "Ativa" : "Pausada"}. Previsões não confirmam
          receitas. Feriados e diferenças de valor precisam de revisão.
        </p>
        {!reader && (
          <div>
            <Button
              variant="quiet"
              size="sm"
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
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
