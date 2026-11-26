"use client";
// "Seu salário entrou": sugestão de quanto guardar, ajuste de R$ 10 em R$ 10,
// combinar ou não guardar este mês. Combinar não move dinheiro: o valor só
// deixa de contar como livre.
import { useState } from "react";
import { Callout } from "../ds/callout.tsx";
import { Button } from "../button.tsx";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { apiAmount, type Money } from "./money.ts";

const STEP = 1000n;
const floorStep = (v: bigint) => (v > 0n ? (v / STEP) * STEP : 0n);

export function DecideStep({
  goalId,
  goalName,
  suggestion,
  livre,
  planId,
  money,
  write,
  onDone,
  onCancel,
  byHabit,
}: {
  goalId: string;
  goalName: string;
  suggestion: bigint;
  livre: bigint;
  /** Plano já existente do mês (para substituir com segurança). */
  planId: string | null;
  money: Money;
  write: (w: CopilotWrite) => Promise<void>;
  onDone: () => void;
  /** Presente quando a pessoa está mudando uma decisão já tomada. */
  onCancel?: () => void;
  /** A sugestão veio do ritmo de sempre (true) ou da metade do livre. */
  byHabit: boolean;
}) {
  const max = floorStep(livre) > STEP ? floorStep(livre) : STEP;
  const [amount, setAmount] = useState(suggestion > 0n ? suggestion : STEP);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"plan" | "skip" | null>(null);
  const [error, setError] = useState("");

  const save = async (planned: bigint, which: "plan" | "skip") => {
    setBusy(which);
    setError("");
    try {
      await write({
        kind: "plan",
        goal_id: goalId,
        planned: apiAmount(planned),
        version_of: planId ?? undefined,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const isSuggestion = amount === suggestion && suggestion > 0n;
  return (
    <Callout
      tone="accent"
      icon="◎"
      title={planId ? "Mudar a reserva do mês" : "Seu salário entrou"}
      meta={`${isSuggestion ? "Sugestão: guardar" : "Guardar"} ${money(amount)} para ${goalName.toLowerCase()}`}
      details={
        <>
          {editing && (
            <div className="cop-amount">
              <Button aria-label="Diminuir 10 reais" disabled={amount <= STEP} onClick={() => setAmount(amount - STEP)}>
                −
              </Button>
              <output aria-live="polite">{money(amount)}</output>
              <Button aria-label="Aumentar 10 reais" disabled={amount >= max} onClick={() => setAmount(amount + STEP)}>
                +
              </Button>
            </div>
          )}
          <div className="cop-actions">
            <Button variant="primary" busy={busy === "plan"} disabled={busy !== null} onClick={() => void save(amount, "plan")}>
              Combinar {money(amount)}
            </Button>
            {!editing && (
              <Button disabled={busy !== null} onClick={() => setEditing(true)}>
                Outro valor
              </Button>
            )}
            <Button variant="text" busy={busy === "skip"} disabled={busy !== null} onClick={() => void save(0n, "skip")}>
              Não guardar este mês
            </Button>
            {onCancel && (
              <Button variant="text" disabled={busy !== null} onClick={onCancel}>
                Cancelar
              </Button>
            )}
          </div>
          {error && (
            <p className="cop-err alert alert-soft alert-error" role="alert">
              {error}
            </p>
          )}
        </>
      }
    >
      {isSuggestion
        ? byHabit
          ? "É o que sobra depois do dia a dia de sempre até o salário. "
          : "É metade do que está livre, porque ainda não há histórico do dia a dia. "
        : ""}
      Combinar não move dinheiro: o valor só deixa de contar como livre. Fica livre: <b>{money(livre - amount)}</b>.
    </Callout>
  );
}
