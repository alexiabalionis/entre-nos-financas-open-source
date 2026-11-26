"use client";
// Mês apertado: explica onde apertou, mostra o efeito de pausar a reserva e
// pausa no próprio aviso. Depois de pausado, oferece voltar ao plano anterior.
import { useState } from "react";
import { Callout } from "../ds/callout.tsx";
import { Button } from "../button.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { apiAmount, type Money } from "./money.ts";
import { stepCopy } from "./next-step-copy.ts";
import { pauseEffect, pausedFrom, pausedPlanned } from "./pause.ts";

export function PauseStep({
  copilot,
  money,
  reader,
  write,
}: {
  copilot: CopilotWire;
  money: Money;
  reader: boolean;
  write: (w: CopilotWrite) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = stepCopy(copilot, money);
  const goal = copilot.goal;
  const plan = goal?.plan ?? null;
  if (!copy) return null;

  const save = async (planned: bigint) => {
    if (!goal || !plan) return;
    setBusy(true);
    setError("");
    try {
      await write({ kind: "plan", goal_id: goal.id, planned: apiAmount(planned), version_of: plan.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const effect = copilot.action.kind === "short" && copilot.action.canPausePlan ? pauseEffect(copilot, money) : null;
  const previous = pausedFrom(plan);
  const remaining = BigInt(plan?.remaining ?? "0");

  return (
    <Callout
      tone={copy.tone}
      icon={copy.icon}
      title={copy.title}
      meta={copy.meta}
      details={
        <>
          {effect && (
            <ul className="cop-steps">
              <li>
                <span>Agora</span>
                <span>{effect.now}</span>
              </li>
              <li>
                <span>Pausando</span>
                <span>{effect.paused}</span>
              </li>
            </ul>
          )}
          {previous !== null && (
            <p className="ds-caption">
              Reserva pausada neste mês. Antes: {money(previous)} · agora: {money(BigInt(plan!.planned))}.
            </p>
          )}
          {!reader && effect && (
            <div className="cop-actions">
              <Button variant="primary" busy={busy} onClick={() => void save(pausedPlanned(plan!))}>
                Pausar a reserva deste mês
              </Button>
            </div>
          )}
          {!reader && previous !== null && (
            <div className="cop-links">
              <Button variant="text" busy={busy} onClick={() => void save(previous)}>
                Voltar ao plano anterior
              </Button>
            </div>
          )}
          {error && (
            <p className="cop-err alert alert-soft alert-error" role="alert">
              {error}
            </p>
          )}
        </>
      }
    >
      {copy.body}
      {effect ? ` A reserva de ${money(remaining)} ainda não foi separada; pausar libera esse valor.` : ""}
    </Callout>
  );
}
