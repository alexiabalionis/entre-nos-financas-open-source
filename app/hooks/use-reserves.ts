"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Goal } from "../copilot/model.ts";
import type { CopilotWrite } from "./use-copilot.ts";
import type { CopilotWire } from "../../src/server/copilot.ts";

/**
 * Hook focado para Reservas e Margem dentro do Copiloto Futuro.
 * Busca apenas GET reserves e GET family/copilot (sem investments/cards),
 * e notifica `onMutated` após qualquer gravação para manter o Futuro em dia.
 */
export function useReserves(today: string, onMutated?: () => void) {
  const month = today.slice(0, 7);
  const [copilot, setCopilot] = useState<CopilotWire | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await api<Goal[]>("reserves", undefined, signal);
      const next = await api<CopilotWire>("family/copilot", undefined, signal);
      setGoals(list);
      setCopilot(next);
      setError("");
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [month, reload]);

  const write = useCallback(
    async (w: CopilotWrite) => {
      if (w.kind === "void")
        await api("reserves/void", { id: w.id, reason: "Desfeito na tela Copiloto" });
      else if (w.kind === "location")
        await api("reserves/location", {
          goal_id: w.goal_id,
          location: w.location,
          version: w.version,
        });
      else if (w.kind === "margin")
        await api("reserves/margin", { amount: w.amount });
      else if (w.kind === "goal_create")
        await api("reserves/create", {
          name: w.name,
          target: w.target,
          deadline_month: w.deadline_month,
        });
      else if (w.kind === "goal_update")
        await api("reserves/update", {
          goal_id: w.goal_id,
          name: w.name,
          target: w.target,
          deadline_month: w.deadline_month,
          version: w.version,
        });
      else if (w.kind === "plan")
        await api("reserves/plan", {
          goal_id: w.goal_id,
          month,
          planned: w.planned,
          ...(w.version_of ? { version_of: w.version_of } : {}),
        });
      else
        await api("reserves/movement", {
          goal_id: w.goal_id,
          kind: w.kind,
          amount: w.amount,
          date: today,
          ...(w.plan_id ? { plan_id: w.plan_id } : {}),
        });
      await reload();
      onMutated?.();
    },
    [reload, today, month, onMutated],
  );

  return { copilot, goals, error, reload, write };
}
