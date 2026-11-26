"use client";
// A reserva do mês depois de combinada: separar, já separado (aguardando o
// extrato), confirmado ou "neste mês, sem reserva". Tudo no próprio aviso.
import { useState } from "react";
import { Callout } from "../ds/callout.tsx";
import { Button } from "../button.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { ddmm } from "../month/format.ts";
import { lastDeclared, type Goal } from "./model.ts";
import { apiAmount, type Money } from "./money.ts";
import { GoalLocation } from "./goal-location.tsx";
import { pausedFrom } from "./pause.ts";

type CopilotGoal = NonNullable<CopilotWire["goal"]>;

export function PlanStep({
  goal,
  listed,
  money,
  reader,
  write,
  onChange,
}: {
  goal: CopilotGoal;
  /** O mesmo objetivo vindo de GET reserves (tem o histórico). */
  listed: Goal | null;
  money: Money;
  reader: boolean;
  write: (w: CopilotWrite) => Promise<void>;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = goal.plan;
  if (!plan) return null;
  const remaining = BigInt(plan.remaining);
  const separated = BigInt(plan.separated);
  const since = `Combinado em ${ddmm(plan.plan_date)}`;

  const run = async (w: CopilotWrite) => {
    setBusy(true);
    setError("");
    try {
      await write(w);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const errorLine = error ? <p className="cop-err alert alert-soft alert-error" role="alert">{error}</p> : null;
  const change = !reader && (
    <Button variant="text" disabled={busy} onClick={onChange}>
      Mudar a decisão
    </Button>
  );

  const previous = pausedFrom(plan);
  if (previous !== null)
    return (
      <Callout
        tone="neutral"
        icon="◎"
        title="Reserva pausada neste mês"
        meta={`Antes: ${money(previous)} · agora: ${money(BigInt(plan.planned))}`}
        details={
          !reader && (
            <div className="cop-links">
              <Button
                variant="text"
                busy={busy}
                onClick={() =>
                  void run({ kind: "plan", goal_id: goal.id, planned: apiAmount(previous), version_of: plan.id })
                }
              >
                Voltar ao plano anterior
              </Button>
              {errorLine}
            </div>
          )
        }
      >
        O que faltava separar voltou a contar como livre. No próximo salário a gente combina de novo.
      </Callout>
    );

  if (goal.cycle === "skipped")
    return (
      <Callout tone="neutral" icon="◎" title="Neste mês, sem reserva" meta={`Decidido em ${ddmm(plan.plan_date)}`} details={<div className="cop-links">{change}</div>}>
        Tudo bem. No próximo salário a gente pergunta de novo.
      </Callout>
    );

  if (remaining > 0n) {
    const where =
      goal.location === "same_account"
        ? "Deixe esse valor parado na própria conta."
        : "Faça um PIX para a sua caixinha ou investimento.";
    return (
      <Callout
        tone="accent"
        icon="◎"
        title={`Separe ${money(remaining)} para a reserva`}
        meta={`${since} · ${separated > 0n ? `já separou ${money(separated)}` : "ainda não separado"}`}
        details={
          reader ? null : goal.location === null || !listed ? (
            listed && <GoalLocation goal={listed} write={write} />
          ) : (
            <>
              <div className="cop-actions">
                <Button
                  variant="primary"
                  busy={busy}
                  onClick={() =>
                    void run({ kind: "deposit", goal_id: goal.id, amount: apiAmount(remaining), plan_id: plan.id })
                  }
                >
                  Já separei {money(remaining)}
                </Button>
              </div>
              <div className="cop-links">{change}</div>
              {errorLine}
            </>
          )
        }
      >
        {where} O livre já não conta com esse dinheiro.
      </Callout>
    );
  }

  const pending = listed ? lastDeclared(listed) : null;
  const undo = !reader && pending && (
    <Button variant="text" busy={busy} onClick={() => void run({ kind: "void", id: pending.id })}>
      Desfazer: não separei
    </Button>
  );
  const left = BigInt(goal.saved) < BigInt(listed?.target_cents ?? "0");
  const toGoal = left
    ? ` Faltam ${money(BigInt(listed!.target_cents) - BigInt(goal.saved))} para a meta.`
    : "";
  if (BigInt(goal.declared) > 0n && goal.location !== "same_account")
    return (
      <Callout tone="accent" icon="◎" title={`Você separou ${money(separated)}`} meta="Informado por você · aguardando o extrato" details={<div className="cop-links">{undo}{errorLine}</div>}>
        Quando o banco mostrar a transferência, a gente confirma sozinho. Você não precisa fazer nada.
      </Callout>
    );
  return (
    <Callout
      tone="ok"
      icon="✓"
      title={`${money(separated)} guardados`}
      meta={goal.location === "same_account" ? "Na própria conta" : "Confirmado no extrato"}
      details={<div className="cop-links">{goal.location === "same_account" ? undo : null}{errorLine}</div>}
    >
      {`Esse valor já não conta como livre.${toGoal}`}
    </Callout>
  );
}
