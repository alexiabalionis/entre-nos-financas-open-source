"use client";
import { AmountStepper, ChangedText } from "../ds/index.ts";
import { cx } from "../ds/shared.ts";
import { formatCents, formatReais, toReais } from "../lib/cents.ts";
import { monthShort } from "../../src/domain/future-months.ts";
import { useFutureContext } from "./future-context.tsx";
import { contributionChange, neededForDeadline, plannedMonthly, reachText } from "./view-model.ts";

/**
 * Quanto guardar por mês em um objetivo. Mostra o valor do rascunho (ou do plano
 * vigente), simula a mudança e diz quando o objetivo completa. Zero vira pausa;
 * voltar ao valor do plano desfaz a simulação. Não grava: quem grava é a barra.
 */
export function ContributionControl({ goalId }: { goalId: string }) {
  const f = useFutureContext();
  const input = f.draftInput;
  const goal = input?.goals.find((g) => g.id === goalId);
  if (!input || !goal || !f.draft) return null;
  const start = input.startMonth;
  const current = plannedMonthly(goal.plans, start);
  const saved = f.input?.goals.find((g) => g.id === goalId);
  const planned = saved ? plannedMonthly(saved.plans, start) : 0n;
  const need = neededForDeadline(start, goal);
  // Teto do campo: o que falta para completar. Mais do que isso não entra no
  // objetivo (o motor para no alvo), então aceitar um valor maior só esconderia
  // a conta e gravaria um plano que não existe. Arredonda para cima no passo.
  const missing = goal.target > goal.saved ? goal.target - goal.saved : 0n;
  const maxReais = Math.max(50, Math.ceil(toReais(missing) / 50) * 50);

  const change = (reais: number) => {
    const c = contributionChange(planned, reais);
    if (c.kind === "clear") {
      f.remove("contributions", goalId);
      f.remove("pauses", goalId);
    } else if (c.kind === "pause") {
      f.remove("contributions", goalId);
      f.patch({ pauses: [{ goalId, fromMonth: start, months: input.months }] });
    } else {
      f.remove("pauses", goalId);
      f.patch({ contributions: [{ goalId, fromMonth: start, months: null, cents: c.cents }] });
    }
  };

  return (
    <div className={cx("ds-reset", "fut-contribution")}>
      <AmountStepper
        hidden={f.hidden}
        label={`Quanto guardar por mês em ${goal.name}`}
        value={Math.min(toReais(current), maxReais)}
        step={50}
        max={maxReais}
        onChange={(v) => change(Math.min(v, maxReais))}
        hint={
          <>
            {`Faltam ${formatCents(missing, f.hidden)} para completar. `}
            {saved ? `No plano: ${formatCents(planned, f.hidden)}. ` : ""}
            <ChangedText value={reachText(f.draft, goalId)} />
            {need !== null && goal.deadlineMonth
              ? ` Para chegar até ${monthShort(goal.deadlineMonth)} precisa de ${formatReais(toReais(need), f.hidden)}/mês.`
              : ""}
          </>
        }
      />
    </div>
  );
}
