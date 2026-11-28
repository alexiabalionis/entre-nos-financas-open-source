"use client";
import { useId, useState } from "react";
import { Button } from "../ds/button.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import { lastDeclared, parseAmount, saved, type Goal } from "./model.ts";
import { apiAmount, type Money } from "./money.ts";
import { pausedFrom, pausedPlanned } from "./pause.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";

type Kind = "deposit" | "withdrawal";
type PlanWire = NonNullable<NonNullable<CopilotWire["goal"]>["plan"]>;

export function GoalActions({
  goal,
  money,
  primaryPlan,
  write,
  onDone,
}: {
  goal: Goal;
  money: Money;
  primaryPlan?: PlanWire | null;
  write: (w: CopilotWrite) => Promise<void>;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState<Kind | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const balance = saved(goal);
  const undo = lastDeclared(goal);

  const currentPlan = goal.current_plan;
  const resumedAmount = pausedFrom(primaryPlan ?? null);
  const canPause =
    currentPlan && BigInt(currentPlan.planned_cents) > 0n;
  const pauseTarget = primaryPlan
    ? apiAmount(pausedPlanned(primaryPlan))
    : "0,00";

  const run = async (w: CopilotWrite, message: string) => {
    setBusy(true);
    setError("");
    try {
      await write(w);
      setForm(null);
      setValue("");
      onDone(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!form) return;
    const parsed = parseAmount(value, form === "withdrawal" ? balance : null, money);
    if (!parsed.ok) return setError(parsed.error);
    const amount = money(parsed.cents);
    const plan = goal.current_plan;
    const planId =
      form === "deposit" && plan && plan.planned_cents !== "0"
        ? plan.id
        : undefined;
    void run(
      { kind: form, goal_id: goal.id, amount: parsed.value, plan_id: planId },
      form === "deposit"
        ? `${amount} guardados. Fica aguardando o extrato.`
        : `Retirada de ${amount} registrada. Fica aguardando o extrato.`,
    );
  };

  if (form)
    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
        <label className="text-xs font-medium text-ink" htmlFor={inputId}>
          {form === "deposit" ? "Quanto guardar" : "Quanto retirar"} de{" "}
          {goal.name}, em reais
        </label>
        <input
          id={inputId}
          inputMode="decimal"
          placeholder="Ex.: 50"
          value={value}
          className="font-numeric text-base"
          aria-invalid={error ? true : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p
            className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-medium text-danger"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" busy={busy} onClick={submit}>
            {form === "deposit" ? "Registrar guardado" : "Registrar retirada"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setForm(null);
              setError("");
            }}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );

  const open = (kind: Kind) => {
    setForm(kind);
    setValue("");
    setError("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" icon="plus" onClick={() => open("deposit")}>
          Guardar
        </Button>
        {balance > 0n && (
          <Button variant="secondary" size="sm" icon="minus" onClick={() => open("withdrawal")}>
            Retirar
          </Button>
        )}
        {canPause && (
          <Button
            variant="quiet"
            size="sm"
            icon="pause"
            busy={busy}
            onClick={() =>
              void run(
                {
                  kind: "plan",
                  goal_id: goal.id,
                  planned: pauseTarget,
                  version_of: currentPlan.id,
                },
                "Reserva pausada neste mês. Nada foi apagado.",
              )
            }
          >
            Pausar este mês
          </Button>
        )}
        {!canPause && resumedAmount !== null && primaryPlan && (
          <Button
            variant="quiet"
            size="sm"
            icon="play"
            busy={busy}
            onClick={() =>
              void run(
                {
                  kind: "plan",
                  goal_id: goal.id,
                  planned: apiAmount(resumedAmount),
                  version_of: primaryPlan.id,
                },
                "Plano mensal retomado.",
              )
            }
          >
            Retomar plano
          </Button>
        )}
        {undo && (
          <Button
            variant="secondary"
            size="sm"
            icon="undo"
            className="!text-danger !border-danger/30 hover:!bg-danger-bg"
            busy={busy}
            onClick={() =>
              void run(
                { kind: "void", id: undo.id },
                "Desfeito. O saldo já foi atualizado.",
              )
            }
          >
            Desfazer o último
          </Button>
        )}
      </div>
      {error && (
        <p
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
