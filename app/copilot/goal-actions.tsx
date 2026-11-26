"use client";
// Ações do objetivo dentro do próprio cartão: guardar, retirar e desfazer o
// último informado. O resultado aparece aqui mesmo (onDone), não no topo.
import { useId, useState } from "react";
import { Button } from "../button.tsx";
import { lastDeclared, parseAmount, saved, type Goal } from "./model.ts";
import type { Money } from "./money.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";

type Kind = "deposit" | "withdrawal";

export function GoalActions({
  goal,
  money,
  write,
  onDone,
}: {
  goal: Goal;
  money: Money;
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
    // Guardar com plano do mês combinado conta para esse plano.
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
      <div className="cop-inline">
        <label className="ds-caption" htmlFor={inputId}>
          {form === "deposit" ? "Quanto guardar" : "Quanto retirar"} de {goal.name}, em reais
        </label>
        <input
          id={inputId}
          inputMode="decimal"
          placeholder="Ex.: 50"
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p className="cop-err alert alert-soft alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="cop-actions">
          <Button variant="primary" busy={busy} onClick={submit}>
            {form === "deposit" ? "Registrar guardado" : "Registrar retirada"}
          </Button>
          <Button variant="text" disabled={busy} onClick={() => { setForm(null); setError(""); }}>
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
    <div className="cop-links">
      <Button variant="text" onClick={() => open("deposit")}>
        Guardar
      </Button>
      {balance > 0n && (
        <Button variant="text" onClick={() => open("withdrawal")}>
          Retirar
        </Button>
      )}
      {undo && (
        <Button
          variant="text"
          busy={busy}
          onClick={() =>
            void run({ kind: "void", id: undo.id }, "Desfeito. O saldo já foi atualizado.")
          }
        >
          Desfazer o último informado
        </Button>
      )}
      {error && (
        <p className="cop-err alert alert-soft alert-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
