"use client";
// Estado do formulário de reserva (nova ou editar nome/meta/prazo). Dono do
// rascunho, da validação e da gravação — o diálogo só desenha.
import { useState } from "react";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { amountInput } from "./money.ts";
import { parseAmount, validateName, type Goal } from "./model.ts";
import type { Money } from "./money.ts";

export type GoalDraft = { name: string; target: string; deadline: string };
const EMPTY: GoalDraft = { name: "", target: "", deadline: "" };

export function useGoalForm({
  money,
  write,
}: {
  money: Money;
  write: (w: CopilotWrite) => Promise<void>;
}) {
  // null = fechado; "new" = criando; Goal = editando esse objetivo.
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openCreate = () => {
    setDraft(EMPTY);
    setShowErrors(false);
    setError("");
    setEditing("new");
  };
  const openEdit = (goal: Goal) => {
    setDraft({
      name: goal.name,
      target: amountInput(BigInt(goal.target_cents)),
      deadline: goal.deadline_month ? goal.deadline_month.slice(0, 7) : "",
    });
    setShowErrors(false);
    setError("");
    setEditing(goal);
  };
  const close = () => setEditing(null);
  const edit = (patch: Partial<GoalDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const nameError = validateName(draft.name);
  const amount = parseAmount(draft.target, null, money);
  const amountError = amount.ok ? "" : amount.error;

  const save = async () => {
    if (nameError || !amount.ok) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const name = draft.name.trim();
      const target = amount.value;
      const deadline_month = draft.deadline || null;
      if (editing === "new") {
        await write({ kind: "goal_create", name, target, deadline_month });
      } else if (editing) {
        await write({
          kind: "goal_update",
          goal_id: editing.id,
          version: editing.version,
          name,
          target,
          deadline_month,
        });
      }
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    editing,
    draft,
    showErrors,
    busy,
    error,
    nameError,
    amountError,
    openCreate,
    openEdit,
    close,
    edit,
    save,
  };
}
