"use client";
// Dados do Panorama (GET family/insights). Só leitura. Relê ao voltar para a
// aba e quando os bancos foram lidos de novo (useRefreshOnReturn), mantendo o
// que já está na tela enquanto busca: a página não pisca, só os números mudam.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useRefreshOnReturn } from "./use-refresh-on-return.ts";
import type { InsightsWire } from "../../src/server/insights.ts";

/** `month` (YYYY-MM) ancora o Panorama: mês passado mostra como estava no fim dele. */
export function useInsights(month?: string) {
  const [data, setData] = useState<InsightsWire | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // Só a busca mais recente grava (uma volta lenta não sobrescreve uma nova).
  const ticket = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const mine = ++ticket.current;
    setRefreshing(true);
    try {
      const next = await api<InsightsWire>(
        month ? `family/insights?month=${month}` : "family/insights",
        undefined,
        signal,
      );
      if (mine !== ticket.current) return;
      setData(next);
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      if (!signal?.aborted && mine === ticket.current) setError((e as Error).message);
    } finally {
      if (mine === ticket.current) setRefreshing(false);
    }
  }, [month]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  useRefreshOnReturn(reload, true);
  return { data, error, reload, refreshing, updatedAt };
}
