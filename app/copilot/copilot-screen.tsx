"use client";
// Tela Copiloto: total em reservas, um cartão por objetivo e, no fim,
// investimentos e faturas futuras compactos. Não muda nenhuma outra aba.
import { Stepper } from "../ds/stepper.tsx";
import { Button } from "../button.tsx";
import { ddmm } from "../month/format.ts";
import { useCopilot } from "../hooks/use-copilot.ts";
import { moneyOf } from "./money.ts";
import { TotalPanel } from "./total-panel.tsx";
import { MoneyHero } from "./money-hero.tsx";
import { NextStep } from "./next-step.tsx";
import { WeeksPanel } from "./weeks-panel.tsx";
import { MarginPanel } from "./margin-panel.tsx";
import { GoalCard } from "./goal-card.tsx";
import { GoalFormDialog } from "./goal-form-dialog.tsx";
import { useGoalForm } from "./use-goal-form.ts";
import { InvestmentsPanel } from "./investments-panel.tsx";
import { BillsPanel } from "./bills-panel.tsx";

export function CopilotScreen({
  today,
  hidden,
  reader,
}: {
  today: string;
  hidden: boolean;
  reader: boolean;
}) {
  const { copilot, goals, investments, bills, error, reload, write } =
    useCopilot(today);
  const money = moneyOf(hidden);
  const listed =
    goals?.find((g) => g.id === copilot?.goal?.id) ?? null;
  const form = useGoalForm({ money, write });
  return (
    <div className="ds-list ds-stagger cop-screen">
      <Stepper label="Copiloto" caption={`Hoje, ${ddmm(today)}`} canPrev={false} canNext={false} />
      {error && (
        <p role="alert" className="ds-caption alert alert-soft alert-error">
          {error}{" "}
          <Button variant="text" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </p>
      )}
      {!goals && !error && (
        <p role="status" className="ds-caption alert alert-soft alert-info">
          Carregando suas reservas…
        </p>
      )}
      {copilot && (
        <>
          <MoneyHero copilot={copilot} money={money} />
          <NextStep
            copilot={copilot}
            listed={listed}
            money={money}
            reader={reader}
            write={write}
          />
          <WeeksPanel copilot={copilot} money={money} />
        </>
      )}
      {goals && (
        <>
          <TotalPanel goals={goals} money={money} />
          {!reader && (
            <div className="cop-links">
              <Button variant="text" onClick={form.openCreate}>
                + Nova reserva
              </Button>
            </div>
          )}
          {goals.map((goal, index) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              index={index}
              today={today}
              money={money}
              reader={reader}
              write={write}
              onEdit={form.openEdit}
            />
          ))}
        </>
      )}
      <GoalFormDialog
        open={form.editing !== null}
        isNew={form.editing === "new"}
        draft={form.draft}
        showErrors={form.showErrors}
        nameError={form.nameError}
        amountError={form.amountError}
        busy={form.busy}
        error={form.error}
        onEdit={form.edit}
        onSave={() => void form.save()}
        onClose={form.close}
      />
      {copilot && copilot.state !== "INDETERMINADO" && (
        <MarginPanel copilot={copilot} money={money} reader={reader} write={write} />
      )}
      <InvestmentsPanel data={investments} money={money} />
      <BillsPanel data={bills} money={money} />
    </div>
  );
}
