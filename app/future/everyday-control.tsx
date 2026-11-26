"use client";
import { AmountStepper } from "../ds/index.ts";
import { cx } from "../ds/shared.ts";
import { formatReais, toReais } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";
import { everydayPatch, monthlyFromWeekly } from "./view-model.ts";

/**
 * Controle do gasto do dia a dia (média por mês). A projeção guarda o valor por
 * semana, então converte mensal ↔ semanal. Sem média conhecida, só avisa. Simula
 * mesmo no modo leitura (nada é gravado). A conta fica em view-model.
 */
export function EverydayControl() {
  const f = useFutureContext();
  const input = f.draftInput;
  if (!input) return null;
  const weekly = input.everyday.weekly;
  if (input.everyday.source === "ausente" || weekly === null)
    return <p className={cx("ds-reset", "fut-everyday-empty")}>Ainda não há média do dia a dia.</p>;
  const planWeekly = f.input?.everyday.weekly ?? weekly;
  const monthly = toReais(monthlyFromWeekly(weekly));
  const planMonthly = toReais(monthlyFromWeekly(planWeekly));
  return (
    <div className={cx("ds-reset", "fut-everyday")}>
      <AmountStepper
        hidden={f.hidden}
        label="Gasto do dia a dia (média por mês)"
        value={monthly}
        step={50}
        onChange={(v) => f.patch({ everydayWeekly: everydayPatch(planWeekly, v) })}
        hint={`${input.everyday.source === "medido" ? "Medido nas últimas 8 semanas" : "Valor informado"}: ${formatReais(planMonthly, f.hidden)}.${
          input.fixed.length === 0 ? " Sem contas fixas cadastradas, aluguel e assinaturas entram aqui." : ""
        } Cada R$ 50 a menos vira R$ 50 de folga por mês.`}
      />
    </div>
  );
}
