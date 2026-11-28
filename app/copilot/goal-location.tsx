"use client";
import { useState } from "react";
import { Button } from "../ds/button.tsx";
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
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
      <p className="ds-caption m-0">
        <strong className="text-ink">Onde esse dinheiro vai ficar?</strong>{" "}
        Assim a gente sabe se ele ainda aparece no saldo da sua conta.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={busy === "same_account"}
          disabled={busy !== null}
          onClick={() => void choose("same_account")}
        >
          Na mesma conta
        </Button>
        <Button
          variant="secondary"
          size="sm"
          busy={busy === "elsewhere"}
          disabled={busy !== null}
          onClick={() => void choose("elsewhere")}
        >
          Em outro lugar (caixinha, investimento)
        </Button>
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
