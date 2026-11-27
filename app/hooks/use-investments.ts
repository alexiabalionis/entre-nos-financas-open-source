"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Investments } from "./use-copilot.ts";

/**
 * Busca os saldos de investimentos para o mês selecionado sem bloquear o
 * carregamento principal do Panorama. Falhas ficam silenciosas para que o
 * restante do painel continue utilizável.
 */
export function useInvestments(month: string): Investments | null {
  const [state, setState] = useState<{ month: string; data: Investments } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<Investments>("investments?month=" + encodeURIComponent(month), undefined, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setState({ month, data: res });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(null);
      });
    return () => controller.abort();
  }, [month]);

  return state && state.month === month ? state.data : null;
}
