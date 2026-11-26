"use client";
// Um único aviso com o passo do momento, logo abaixo do número livre. A
// ordem dos casos vem de nextAction (servidor); aqui só escolhe o bloco.
import { useState } from "react";
import { Callout } from "../ds/callout.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import type { Goal } from "./model.ts";
import type { Money } from "./money.ts";
import { stepCopy } from "./next-step-copy.ts";
import { DecideStep } from "./decide-step.tsx";
import { PlanStep } from "./plan-step.tsx";
import { PauseStep } from "./pause-step.tsx";

export function NextStep({
  copilot,
  listed,
  money,
  reader,
  write,
}: {
  copilot: CopilotWire;
  listed: Goal | null;
  money: Money;
  reader: boolean;
  write: (w: CopilotWrite) => Promise<void>;
}) {
  const [changing, setChanging] = useState(false);
  const { action, goal } = copilot;
  const plan = goal?.plan ?? null;

  if (goal && !reader && (changing || action.kind === "decide")) {
    // Livre sem o plano atual, para o "Fica livre" não descontar duas vezes.
    const base = BigInt(copilot.livre) + BigInt(plan?.remaining ?? "0");
    const planned = BigInt(plan?.planned ?? "0");
    return (
      <DecideStep
        key={plan?.id ?? "new"}
        goalId={goal.id}
        goalName={goal.name}
        suggestion={planned > 0n ? planned : BigInt(copilot.suggestion)}
        livre={base}
        planId={plan?.id ?? null}
        money={money}
        write={write}
        onDone={() => setChanging(false)}
        onCancel={changing ? () => setChanging(false) : undefined}
        byHabit={copilot.usualWeekly !== null}
      />
    );
  }
  if (action.kind === "short")
    return <PauseStep copilot={copilot} money={money} reader={reader} write={write} />;
  const reserveStep =
    goal && plan && (action.kind === "separate" || (action.kind === "ok" && goal.cycle !== "not_planned"));
  if (reserveStep)
    return (
      <PlanStep goal={goal} listed={listed} money={money} reader={reader} write={write} onChange={() => setChanging(true)} />
    );
  const copy = stepCopy(copilot, money);
  if (!copy) return null;
  return (
    <Callout tone={copy.tone} icon={copy.icon} title={copy.title} meta={copy.meta}>
      {copy.body}
    </Callout>
  );
}
