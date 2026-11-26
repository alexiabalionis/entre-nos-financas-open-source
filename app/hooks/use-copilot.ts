"use client";
// Dados da tela Copiloto: o retrato do mês (GET family/copilot: dinheiro
// livre, próximo passo, plano), os objetivos (GET reserves) e, como
// complemento, investimentos e faturas futuras. Toda
// escrita recarrega o retrato e os objetivos juntos.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Goal } from "../copilot/model.ts";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { readInvestments } from "../../src/server/future.ts";
import type { readCardProjection } from "../../src/server/cards.ts";

export type Investments = Awaited<ReturnType<typeof readInvestments>>;
export type CardProjection = Awaited<ReturnType<typeof readCardProjection>>;

export type CopilotWrite =
  | {
      kind: "deposit" | "withdrawal";
      goal_id: string;
      amount: string;
      plan_id?: string;
    }
  | { kind: "void"; id: string }
  | {
      kind: "location";
      goal_id: string;
      location: "same_account" | "elsewhere";
      version: number;
    }
  | { kind: "plan"; goal_id: string; planned: string; version_of?: string }
  | { kind: "margin"; amount: string | null }
  | { kind: "goal_create"; name: string; target: string; deadline_month: string | null }
  | {
      kind: "goal_update";
      goal_id: string;
      name: string;
      target: string;
      deadline_month: string | null;
      version: number;
    };

export function useCopilot(today: string) {
  const month = today.slice(0, 7);
  const [copilot, setCopilot] = useState<CopilotWire | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [investments, setInvestments] = useState<Investments | null>(null);
  const [bills, setBills] = useState<CardProjection | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      // reserves primeiro: cria a "Primeira reserva" quando ainda não existe.
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
    // Complementares: falha não bloqueia a tela, o bloco só não aparece.
    void api<Investments>("investments?month=" + month, undefined, controller.signal)
      .then(setInvestments)
      .catch(() => {});
    void api<CardProjection>("cards/projection?month=" + month, undefined, controller.signal)
      .then(setBills)
      .catch(() => {});
    return () => controller.abort();
  }, [month, reload]);

  // Lança o erro da API para o bloco mostrar no próprio lugar da ação.
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
    },
    [reload, today, month],
  );

  return { copilot, goals, investments, bills, error, reload, write };
}
