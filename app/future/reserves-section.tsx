"use client";
import { useEffect } from "react";
import { AccordionGroup } from "../ds/accordion-group.tsx";
import { Button } from "../ds/button.tsx";
import { Icon } from "../ds/icon.tsx";
import { FlatPanelsProvider } from "../ds/panel.tsx";
import { StatusChip } from "../ds/status-chip.tsx";
import { TotalPanel } from "../copilot/total-panel.tsx";
import { GoalCard } from "../copilot/goal-card.tsx";
import { GoalFormDialog } from "../copilot/goal-form-dialog.tsx";
import { MarginPanel } from "../copilot/margin-panel.tsx";
import { totals } from "../copilot/model.ts";
import { moneyOf } from "../copilot/money.ts";
import { useGoalForm } from "../copilot/use-goal-form.ts";
import { useReserves } from "../hooks/use-reserves.ts";
import { today } from "../lib/dates.ts";

/**
 * Seção "Reservas e metas" integrada ao Copiloto Futuro:
 * total acumulado, margem de segurança, cartões por objetivo, ações e pausa mensal.
 */
export function ReservesSection({
  hidden,
  reader,
  syncKey,
  onMutated,
  showTotalPanel = true,
  collapseMargin = false,
}: {
  hidden: boolean;
  reader: boolean;
  syncKey: number;
  onMutated: () => void;
  showTotalPanel?: boolean;
  collapseMargin?: boolean;
}) {
  const currentDay = today();
  const money = moneyOf(hidden);
  const { copilot, goals, error, reload, write } = useReserves(
    currentDay,
    onMutated,
  );
  const form = useGoalForm({ money, write });

  useEffect(() => {
    if (syncKey > 0) void reload();
  }, [syncKey, reload]);

  const marginNode =
    goals && copilot ? (
      collapseMargin ? (
        <AccordionGroup
          variant="card"
          defaultOpen={false}
          title="Margem de segurança"
          subtitle="Reserva automática que fica na conta para imprevistos"
          trailing={money(BigInt(copilot.margin))}
        >
          <FlatPanelsProvider>
            <MarginPanel
              copilot={copilot}
              money={money}
              reader={reader}
              write={write}
            />
          </FlatPanelsProvider>
        </AccordionGroup>
      ) : (
        <MarginPanel
          copilot={copilot}
          money={money}
          reader={reader}
          write={write}
        />
      )
    ) : null;

  return (
    <section
      id="reservas"
      aria-label="Reservas e metas"
      className={
        showTotalPanel
          ? "flex scroll-mt-6 flex-col gap-4 border-t border-border pt-6"
          : "flex scroll-mt-6 flex-col gap-4 pt-1"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold tracking-tight text-ink">
              Reservas e metas
            </h2>
            {!showTotalPanel && goals ? (
              <StatusChip
                tone="accent"
                label={
                  <>
                    Total acumulado:{" "}
                    <span className="font-numeric font-semibold tabular-nums">
                      {money(totals(goals).total)}
                    </span>
                  </>
                }
              />
            ) : null}
          </div>
          <p className="m-0 mt-0.5 text-xs text-muted">
            Registre depósitos, retiradas, metas e a margem de segurança do casal.
          </p>
        </div>
        {!reader && (
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={form.openCreate}
          >
            Nova reserva
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
        >
          <span>{error}</span>
          <Button variant="quiet" size="sm" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {goals && copilot && (
        <>
          {showTotalPanel ? (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <TotalPanel goals={goals} money={money} />
              {marginNode}
            </div>
          ) : null}

          {goals.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border-strong bg-surface p-6">
              <div className="flex items-center gap-2.5 text-ink">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                  <Icon name="flag" size={16} />
                </span>
                <strong className="text-sm font-semibold">
                  Nenhuma reserva criada ainda
                </strong>
              </div>
              <p className="m-0 max-w-lg text-sm leading-relaxed text-muted">
                Crie uma primeira reserva (como reserva de emergência ou uma
                meta próxima) para acompanhar o ritmo mensal e simular cenários.
              </p>
              {!reader && (
                <Button
                  variant="primary"
                  size="sm"
                  icon="plus"
                  onClick={form.openCreate}
                >
                  Criar primeira reserva
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              {goals.map((g, i) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  index={i}
                  today={currentDay}
                  money={money}
                  reader={reader}
                  copilot={copilot}
                  write={write}
                  onEdit={form.openEdit}
                />
              ))}
            </div>
          )}

          {!showTotalPanel ? marginNode : null}

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
        </>
      )}
    </section>
  );
}
