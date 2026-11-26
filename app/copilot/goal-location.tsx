"use client";
// Pergunta única antes do primeiro depósito: onde o dinheiro fica. Sem isso o
// app não sabe se ele ainda aparece no saldo da conta.
import { useState } from "react";
import { Button } from "../button.tsx";
import type { Goal } from "./model.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";

type Place = "same_account" | "elsewhere";

export function GoalLocation({
  goal,
  write,
}: {
  goal: Goal;
  write: (w: CopilotWrite) => Promise<void>;
}) {
  const [busy, setBusy] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const choose = async (location: Place) => {
    setBusy(location);
    setError("");
    try {
      await write({ kind: "location", goal_id: goal.id, location, version: goal.version });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="cop-inline">
      <p className="ds-caption">
        <b>Onde esse dinheiro vai ficar?</b> Assim a gente sabe se ele ainda
        aparece no saldo da sua conta.
      </p>
      <div className="cop-actions">
        <Button variant="primary" busy={busy === "same_account"} disabled={busy !== null} onClick={() => void choose("same_account")}>
          Na mesma conta
        </Button>
        <Button busy={busy === "elsewhere"} disabled={busy !== null} onClick={() => void choose("elsewhere")}>
          Em outro lugar (caixinha, investimento)
        </Button>
      </div>
      {error && (
        <p className="cop-err alert alert-soft alert-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
